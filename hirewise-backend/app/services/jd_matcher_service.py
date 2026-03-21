"""
Self-RAG Enhanced JD Matcher
==============================
Architecture:
    - Gemini gemini-embedding-001 → dense vector embeddings
  - FAISS (IndexFlatIP)        → temporary in-memory vector store
  - Groq (llama-3.3-70b)      → generation + self-reflection / critique
  - Self-RAG loop              → retrieve → generate → critique → re-retrieve if needed

Self-RAG tokens used internally:
  [ISREL]  – model judges whether retrieved chunk is relevant
  [ISSUP]  – model judges whether chunk supports the claim
  [ISUSE]  – model judges whether the final answer is useful
"""

from __future__ import annotations

import json
import re
import textwrap
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings

# ── Optional heavy dependencies (all guarded so server never crashes on import) ──

try:
    import numpy as np
    _NUMPY = True
except Exception:
    np = None          # type: ignore
    _NUMPY = False

try:
    import faiss
    _FAISS = True
except Exception:
    faiss = None       # type: ignore
    _FAISS = False

try:
    import google.generativeai as genai
    if settings.gemini_api_key:
        genai.configure(api_key=settings.gemini_api_key)
    _GENAI = bool(settings.gemini_api_key)
except Exception:
    genai = None       # type: ignore
    _GENAI = False

try:
    from groq import Groq as _GroqClient
    _groq_client: Optional[Any] = (
        _GroqClient(api_key=settings.groq_api_key) if settings.groq_api_key else None
    )
    _GROQ = _groq_client is not None
except Exception:
    _groq_client = None
    _GROQ = False

# ── Constants ─────────────────────────────────────────────────────────────────
GROQ_MODEL       = "llama-3.3-70b-versatile"
EMBED_MODEL      = "models/gemini-embedding-001"
EMBED_DIM        = 768
CHUNK_SIZE       = 400
CHUNK_OVERLAP    = 80
TOP_K            = 4
MAX_REFLECT      = 2

MIN_CHARS_RESUME = 100
MIN_CHARS_JD     = 80
MAX_CHARS        = 50_000


# ══════════════════════════════════════════════════════════════════════════════
# Domain exception – raised when a document fails validation
# ══════════════════════════════════════════════════════════════════════════════

class InvalidDocumentError(Exception):
    """Carries a structured payload the REST layer can return directly."""
    def __init__(self, report: Dict) -> None:
        super().__init__(report.get("validation_error", "Invalid document"))
        self.report = report


# ══════════════════════════════════════════════════════════════════════════════
# Utility helpers
# ══════════════════════════════════════════════════════════════════════════════

def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping character-level chunks."""
    chunks, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end].strip())
        start += size - overlap
    return [c for c in chunks if c]


def get_embedding(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> Any:
    """Return a unit-normalised embedding vector via Gemini embeddings API."""
    if not _GENAI or not _NUMPY or genai is None or np is None:
        raise RuntimeError("Gemini SDK or numpy not available for embeddings.")
    # google-generativeai==0.3.1 does not support output_dimensionality in embed_content.
    # Use model output as-is, then truncate to EMBED_DIM using MRL-compatible prefix slicing.
    result = genai.embed_content(
        model=EMBED_MODEL,
        content=text,
        task_type=task_type,
    )
    vec = np.array(result["embedding"], dtype=np.float32)
    if vec.shape[0] < EMBED_DIM:
        raise RuntimeError(
            f"Embedding dimension {vec.shape[0]} is smaller than required {EMBED_DIM}."
        )
    if vec.shape[0] != EMBED_DIM:
        vec = vec[:EMBED_DIM]
    vec /= np.linalg.norm(vec) + 1e-10
    return vec


def batch_embed(texts: List[str], task_type: str = "RETRIEVAL_DOCUMENT") -> Any:
    """Embed a list of texts; returns shape (N, EMBED_DIM)."""
    if np is None:
        raise RuntimeError("numpy not available.")
    vecs = []
    for t in texts:
        vecs.append(get_embedding(t, task_type=task_type))
        time.sleep(0.05)          # gentle rate-limit buffer
    return np.vstack(vecs)


def call_groq(messages: List[Dict], temperature: float = 0.2) -> str:
    """Single call to Groq; returns the assistant message text."""
    if not _GROQ or _groq_client is None:
        raise RuntimeError("Groq client is not available.")
    resp = _groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=2048,
    )
    return resp.choices[0].message.content.strip()


def extract_json(text: str) -> Dict:
    """Robustly extract the first JSON object from a string."""
    text = re.sub(r"```(?:json)?", "", text).strip("` \n")
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group())
    raise ValueError(f"No JSON found in:\n{text[:300]}")


# ══════════════════════════════════════════════════════════════════════════════
# Invalid report builder (shared by validator paths)
# ══════════════════════════════════════════════════════════════════════════════

def _build_invalid_report(errors: Dict[str, str]) -> Dict:
    primary = "; ".join(errors.values())
    return {
        # Legacy keys required by the API router
        "match_score":      0.0,
        "technical_skills": 0.0,
        "experience_score": 0.0,
        "education_score":  0.0,
        "keywords_score":   0.0,
        "matched_skills":   [],
        "missing_skills":   [],
        "recommendations":  [
            "Resume or Job Description is invalid. Please provide valid documents."
        ],
        "ai_analysis": {
            "reason":        primary,
            "field_errors":  errors,
            "pipeline_mode": "validation_failed",
        },
        # Validation-specific fields
        "is_valid":         False,
        "invalid_fields":   list(errors.keys()),
        "validation_error": primary,
        "field_errors":     errors,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Document Validator
# ══════════════════════════════════════════════════════════════════════════════

class DocumentValidator:
    """
    Two-stage validation pipeline:

    Stage 1 – Heuristics (fast, zero API cost)
        • Empty / whitespace-only input
        • Below minimum character threshold
        • Above maximum character threshold (likely binary dump)
        • Gibberish: ratio of non-printable chars > 40 %
        • Repeated-character spam
        • Fewer than 10 words

    Stage 2 – Semantic LLM judge via Groq (only if Stage 1 passes)
        • Do the texts actually look like a resume / job description?
        • Produces a human-readable reason on failure.

    Raises InvalidDocumentError (with a REST-safe report dict) on failure.
    Returns silently on success.
    """

    @staticmethod
    def _heuristic_check(text: str, doc_type: str) -> Optional[str]:
        min_len = MIN_CHARS_RESUME if doc_type == "resume" else MIN_CHARS_JD

        if not text or not text.strip():
            return f"The {doc_type} is empty."

        stripped = text.strip()

        if len(stripped) < min_len:
            return (
                f"The {doc_type} is too short ({len(stripped)} characters). "
                f"A valid {doc_type} should have at least {min_len} characters."
            )

        if len(stripped) > MAX_CHARS:
            return (
                f"The {doc_type} is unusually long ({len(stripped):,} characters). "
                "This may be an incorrect file or binary dump."
            )

        non_printable = sum(
            1 for c in stripped
            if ord(c) > 127 or (ord(c) < 32 and c not in "\n\r\t")
        )
        if non_printable / len(stripped) > 0.40:
            return (
                f"The {doc_type} contains too many non-text characters "
                f"({non_printable}/{len(stripped)})."
            )

        if re.fullmatch(r"(.)\1{49,}", stripped[:200]):
            return f"The {doc_type} appears to be spam or repeated characters."

        if len(stripped.split()) < 10:
            return (
                f"The {doc_type} contains fewer than 10 words. "
                "Please provide the full document text."
            )

        return None

    @staticmethod
    def _semantic_check(resume: str, jd: str) -> Dict:
        prompt = textwrap.dedent(f"""
            You are a document validation assistant.
            Decide whether the two texts are genuinely a resume and a job description.

            Rules:
            - A VALID RESUME must contain at least some of: personal info, skills,
              work experience, education, or projects.
            - A VALID JOB DESCRIPTION must contain at least some of: role title,
              responsibilities, requirements, or qualifications.
            - Random text, lorem ipsum, test strings, unrelated articles, code dumps,
              or any clearly wrong content counts as INVALID.

            RESUME TEXT (first 1500 chars):
            \"\"\"
            {resume[:1500]}
            \"\"\"

            JOB DESCRIPTION TEXT (first 1500 chars):
            \"\"\"
            {jd[:1500]}
            \"\"\"

            Respond ONLY with valid JSON – no prose, no markdown fences:
            {{
              "resume_valid": true,
              "resume_reason": "one sentence",
              "jd_valid": true,
              "jd_reason": "one sentence"
            }}
        """)
        raw = call_groq([{"role": "user", "content": prompt}], temperature=0.0)
        return extract_json(raw)

    def validate(self, resume: str, jd: str) -> None:
        errors: Dict[str, str] = {}

        # Stage 1 – Heuristics
        resume_err = self._heuristic_check(resume, "resume")
        jd_err     = self._heuristic_check(jd, "job description")
        if resume_err:
            errors["resume"] = resume_err
        if jd_err:
            errors["jd"] = jd_err

        if errors:
            raise InvalidDocumentError(_build_invalid_report(errors))

        print("Validation step complete (heuristics passed)")

        # Stage 2 – Semantic LLM judge
        semantic = self._semantic_check(resume, jd)
        if not semantic.get("resume_valid", True):
            errors["resume"] = semantic.get(
                "resume_reason", "The resume does not appear to be a valid resume."
            )
        if not semantic.get("jd_valid", True):
            errors["jd"] = semantic.get(
                "jd_reason", "The job description does not appear to be a valid job description."
            )

        if errors:
            raise InvalidDocumentError(_build_invalid_report(errors))

        print("Validation step complete (semantic check passed)")


# ══════════════════════════════════════════════════════════════════════════════
# Temporary in-memory Vector Store
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class VectorStore:
    """
    Lightweight in-memory FAISS store.
    Supports two namespaces: 'resume' and 'jd'.
    """
    index:  Any       = field(default=None)
    chunks: List[str] = field(default_factory=list)
    labels: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not _FAISS or not _NUMPY or faiss is None:
            raise RuntimeError("FAISS and numpy are required for SRAG vector search.")
        self.index = faiss.IndexFlatIP(EMBED_DIM)

    def add(self, texts: List[str], label: str) -> None:
        self.chunks.extend(texts)
        self.labels.extend([label] * len(texts))
        if self.index is None:
            raise RuntimeError("Vector index is not initialized.")
        vecs = batch_embed(texts, task_type="RETRIEVAL_DOCUMENT")
        self.index.add(vecs)

    def search(self, query: str, k: int = TOP_K, label_filter: Optional[str] = None) -> List[str]:
        if not self.chunks:
            return []
        if self.index is None or self.index.ntotal == 0:
            raise RuntimeError("Vector index is empty or not initialized.")

        q_vec = get_embedding(query, task_type="RETRIEVAL_QUERY").reshape(1, -1)
        n_search = min(k * 3, self.index.ntotal)
        _, indices = self.index.search(q_vec, n_search)
        results = []
        for idx in indices[0]:
            if idx < 0:
                continue
            if label_filter and self.labels[idx] != label_filter:
                continue
            results.append(self.chunks[idx])
            if len(results) == k:
                break
        return results


# ══════════════════════════════════════════════════════════════════════════════
# Self-RAG Core
# ══════════════════════════════════════════════════════════════════════════════

class SelfRAG:
    """
    Implements the Self-RAG loop for a single analytical sub-task.

    Flow per call:
      1. Retrieve relevant chunks from the vector store.
      2. Generate an initial answer over that context.
      3. Critique: [ISREL] [ISSUP] [ISUSE] – accepted?
      4. If not accepted → reformulate query → re-retrieve → regenerate (up to MAX_REFLECT times).
      5. Return the accepted (or best-effort) answer.
    """

    def __init__(self, store: VectorStore) -> None:
        self.store = store

    def retrieve(self, query: str, label_filter: Optional[str] = None) -> List[str]:
        return self.store.search(query, k=TOP_K, label_filter=label_filter)

    def generate(self, task_prompt: str, context_chunks: List[str]) -> str:
        context = "\n---\n".join(context_chunks) if context_chunks else "(no context retrieved)"
        messages = [
            {
                "role": "system",
                "content": (
                    "You are an expert HR analyst and resume screener. "
                    "Answer precisely and return valid JSON only when asked. "
                    "Base your answer strictly on the provided context."
                ),
            },
            {
                "role": "user",
                "content": f"CONTEXT:\n{context}\n\nTASK:\n{task_prompt}",
            },
        ]
        return call_groq(messages)

    def critique(
        self,
        task_prompt: str,
        context_chunks: List[str],
        answer: str,
    ) -> Tuple[bool, str]:
        """
        Returns (accepted: bool, reformulated_query_or_reason: str).
        Uses Self-RAG reflection tokens [ISREL] [ISSUP] [ISUSE] internally.
        """
        context = "\n---\n".join(context_chunks) if context_chunks else "(no context)"
        reflection_prompt = textwrap.dedent(f"""
            You are a self-reflection judge for an AI HR analyst.
            Evaluate the answer using the three Self-RAG criteria:

            [ISREL]  – Is the context relevant to the task?
            [ISSUP]  – Does the context support the specific claims in the answer?
            [ISUSE]  – Is the answer useful, accurate, and complete?

            TASK:
            {task_prompt[:600]}

            CONTEXT PROVIDED:
            {context[:1200]}

            ANSWER PRODUCED:
            {answer[:800]}

            Respond ONLY with valid JSON:
            {{
              "isrel": true,
              "issup": true,
              "isuse": true,
              "accepted": true,
              "reason": "brief reason if not accepted, else ok",
              "reformulated_query": null
            }}
        """)
        raw = call_groq([{"role": "user", "content": reflection_prompt}], temperature=0.0)
        result = extract_json(raw)
        accepted = bool(result.get("accepted", False))
        return accepted, result.get("reformulated_query") or result.get("reason", "")

    def run(
        self,
        task_prompt: str,
        initial_query: str,
        label_filter: Optional[str] = None,
    ) -> str:
        """Execute the retrieve → generate → critique loop."""
        query = initial_query
        for iteration in range(MAX_REFLECT + 1):
            chunks  = self.retrieve(query, label_filter=label_filter)
            answer  = self.generate(task_prompt, chunks)
            accepted, feedback = self.critique(task_prompt, chunks, answer)

            if accepted:
                return answer

            if iteration < MAX_REFLECT:
                query = feedback if len(feedback) > 10 else f"{initial_query} {feedback}"

        return answer   # best-effort after max iterations


# ══════════════════════════════════════════════════════════════════════════════
# JDMatcher  –  public API unchanged, internals fully Self-RAG
# ══════════════════════════════════════════════════════════════════════════════

class JDMatcher:
    """
    Drop-in replacement that routes all scoring through Self-RAG.
    calculate_match_score() always returns the same dict shape as the original.
    """

    def __init__(self) -> None:
        self._store: Optional[VectorStore] = None
        self._rag:   Optional[SelfRAG]     = None

    # ── Internal setup ───────────────────────────────────────────────────────

    def _build_store(self, resume_text: str, job_description: str) -> None:
        """Chunk, embed, and load into a fresh in-memory FAISS store."""
        if not _GENAI:
            raise RuntimeError("Gemini embedding configuration is missing.")
        if not _GROQ:
            raise RuntimeError("Groq configuration is missing.")
        if not _NUMPY:
            raise RuntimeError("numpy is required for SRAG embeddings.")
        if not _FAISS:
            raise RuntimeError("faiss is required for SRAG vector search.")

        print("Building FAISS vector store ...")
        self._store = VectorStore()
        self._rag   = SelfRAG(self._store)

        resume_chunks = chunk_text(resume_text)
        jd_chunks     = chunk_text(job_description)

        self._store.add(resume_chunks, label="resume")
        self._store.add(jd_chunks,     label="jd")
        print(f"Indexed {len(resume_chunks)} resume chunks + {len(jd_chunks)} JD chunks")
        print("FAISS index ready")

    def _teardown(self) -> None:
        self._store = None
        self._rag   = None

    # ── Public entry point ───────────────────────────────────────────────────

    def calculate_match_score(self, resume_text: str, job_description: str) -> Dict:
        """
        Main entry point.

        Pipeline:
          Validation → FAISS store → Self-RAG sub-analyses → final blended report

        On invalid input: returns structured report with zeroed scores and
        human-readable error — pipeline does NOT proceed further.

        On Self-RAG failure: raises a runtime error (SRAG-only mode).

        Return dict always contains the original API keys:
          match_score, technical_skills, experience_score, education_score,
          keywords_score, matched_skills, missing_skills, recommendations, ai_analysis
        """
        # ── 1. Validation gate (hard stop on invalid input) ──────────────────
        try:
            DocumentValidator().validate(resume_text, job_description)
        except InvalidDocumentError as exc:
            print(f"Validation failed: {exc}")
            return exc.report   # pipeline stops here

        # ── 2. Build vector store and run Self-RAG analysis ──────────────────
        pipeline_mode = "self_rag"
        try:
            self._build_store(resume_text, job_description)
            print("Running Self-RAG analysis ...")
            skills_result     = self._analyse_skills()
            print("Skills analysis complete")
            experience_result = self._analyse_experience()
            print("Experience analysis complete")
            culture_result    = self._analyse_culture_fit()
            print("Culture fit analysis complete")
            overall_result    = self._analyse_overall(
                skills_result, experience_result, culture_result
            )
            print("Groq reasoning done")
        except Exception as e:
            raise RuntimeError(f"Self-RAG pipeline failed: {e}") from e
        finally:
            self._teardown()

        # ── 4. Map to legacy API schema ──────────────────────────────────────
        return {
            # Original keys (always present)
            "match_score":      round(min(100.0, max(0.0, float(
                                    overall_result.get("match_score", 0)))), 1),
            "technical_skills": round(min(100.0, max(0.0, float(
                                    overall_result.get("technical_skills_score", 0)))), 1),
            "experience_score": round(min(100.0, max(0.0, float(
                                    overall_result.get("experience_score", 0)))), 1),
            "education_score":  85,
            "keywords_score":   round(min(100.0, max(0.0, float(
                                    overall_result.get("keywords_score", 0)))), 1),
            "matched_skills":   overall_result.get("matched_skills", []),
            "missing_skills":   overall_result.get("missing_skills", []),
            "recommendations":  overall_result.get("recommendations", []),
            # Rich Self-RAG fields nested under ai_analysis
            "ai_analysis": {
                "match_score":           overall_result.get("match_score"),
                "matched_requirements":  overall_result.get("matched_skills", []),
                "missing_requirements":  overall_result.get("missing_skills", []),
                "strength_areas":        overall_result.get("strengths", []),
                "improvement_areas":     overall_result.get("improvement_areas", []),
                "recommendations":       overall_result.get("recommendations", []),
                "hiring_recommendation": overall_result.get("hiring_recommendation"),
                "hiring_rationale":      overall_result.get("hiring_rationale"),
                "seniority_match":       overall_result.get("seniority_match"),
                "bonus_skills":          overall_result.get("bonus_skills", []),
                "culture_fit_score":     overall_result.get("culture_fit_score"),
                "pipeline_mode":         pipeline_mode,
            },
        }

    # ── Sub-analyses (each runs the full Self-RAG loop) ──────────────────────

    def _analyse_skills(self) -> Dict:
        task = textwrap.dedent("""
            Compare the candidate's technical skills against the job description requirements.
            Return ONLY valid JSON with this exact schema:
            {
              "score": <0-100 float>,
              "matched_skills": ["skill1", "skill2"],
              "missing_skills": ["skill3", "skill4"],
              "bonus_skills": ["extra skills the candidate has beyond requirements"]
            }
        """)
        raw = self._rag.run(
            task_prompt=task,
            initial_query="technical skills programming languages frameworks tools required",
        )
        return extract_json(raw)

    def _analyse_experience(self) -> Dict:
        task = textwrap.dedent("""
            Evaluate whether the candidate's years of experience, seniority level, and
            domain experience match what the job description requires.
            Return ONLY valid JSON with this exact schema:
            {
              "score": <0-100 float>,
              "required_years": <int or null>,
              "candidate_years": <int or null>,
              "domain_match": true,
              "seniority_match": "over-qualified | match | under-qualified",
              "notes": "one-line explanation"
            }
        """)
        raw = self._rag.run(
            task_prompt=task,
            initial_query="years of experience required seniority level domain industry",
        )
        return extract_json(raw)

    def _analyse_culture_fit(self) -> Dict:
        task = textwrap.dedent("""
            Assess the candidate's soft skills, communication style, leadership indicators,
            and cultural fit signals relative to the job description's stated values and team.
            Return ONLY valid JSON with this exact schema:
            {
              "score": <0-100 float>,
              "strengths": ["strength1"],
              "gaps": ["gap1"],
              "notes": "one-line summary"
            }
        """)
        raw = self._rag.run(
            task_prompt=task,
            initial_query="soft skills leadership teamwork communication culture values",
        )
        return extract_json(raw)

    def _analyse_overall(
        self,
        skills: Dict,
        experience: Dict,
        culture: Dict,
    ) -> Dict:
        """
        Holistic hiring report using sub-analysis results as grounding context.
        Final score = skills * 0.40 + experience * 0.35 + culture * 0.25
        """
        sub_scores = json.dumps({
            "skills_score":      skills.get("score", 60),
            "matched_skills":    skills.get("matched_skills", []),
            "missing_skills":    skills.get("missing_skills", []),
            "experience_score":  experience.get("score", 70),
            "experience_notes":  experience.get("notes", ""),
            "seniority_match":   experience.get("seniority_match", "match"),
            "culture_score":     culture.get("score", 65),
            "culture_strengths": culture.get("strengths", []),
            "culture_gaps":      culture.get("gaps", []),
        }, indent=2)

        task = textwrap.dedent(f"""
            You have already performed three sub-analyses on a candidate's resume vs a job description.
            Sub-analysis results (use these as ground truth):
            {sub_scores}

            Now produce a FINAL holistic hiring report.
            Compute the overall match score as:
              overall = (skills_score * 0.40) + (experience_score * 0.35) + (culture_score * 0.25)

            Return ONLY valid JSON with this schema:
            {{
              "match_score": <weighted average, 0-100 float, 1 decimal>,
              "technical_skills_score": <float>,
              "experience_score": <float>,
              "culture_fit_score": <float>,
              "keywords_score": <float, estimate based on keyword alignment>,
              "matched_skills": [...],
              "missing_skills": [...],
              "bonus_skills": [...],
              "seniority_match": "over-qualified | match | under-qualified",
              "strengths": ["top 3 candidate strengths"],
              "improvement_areas": ["top 3 areas to improve"],
              "recommendations": ["up to 5 specific actionable recommendations"],
              "hiring_recommendation": "Strong Yes | Yes | Maybe | No",
              "hiring_rationale": "2-sentence rationale"
            }}
        """)

        raw = self._rag.run(
            task_prompt=task,
            initial_query="overall match hiring decision recommendation fit",
        )
        result = extract_json(raw)
        for key in (
            "match_score", "technical_skills_score", "experience_score",
            "culture_fit_score", "keywords_score",
        ):
            if key in result:
                result[key] = round(min(100.0, max(0.0, float(result[key]))), 1)
        return result


