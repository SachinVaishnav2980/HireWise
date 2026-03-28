import re
from typing import Dict, List, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer


class JDSkillService:
    """
    Extracts structured skills from JD and computes resume-vs-JD match.

    Matching strategy:
    - Exact matching (normalized token match)
    - Semantic similarity (TF-IDF embedding cosine similarity)
    """

    REQUIRED_HINTS = ["required", "must", "mandatory", "minimum", "need", "expertise in"]
    PREFERRED_HINTS = ["preferred", "nice to have", "plus", "bonus", "good to have"]

    # Shared skill lexicon for deterministic extraction
    SKILL_LEXICON = {
        "python", "java", "javascript", "typescript", "sql", "mysql", "postgresql", "mongodb",
        "redis", "django", "flask", "fastapi", "node.js", "react", "angular", "vue",
        "spring", "docker", "kubernetes", "aws", "gcp", "azure", "linux", "git",
        "rest", "graphql", "microservices", "ci/cd", "jenkins", "terraform", "spark",
        "hadoop", "nlp", "machine learning", "deep learning", "pytorch", "tensorflow",
        "scikit-learn", "pandas", "numpy", "tableau", "power bi", "excel", "communication",
        "leadership", "problem solving", "system design", "data structures", "algorithms",
    }

    def extract_structured_skills(self, jd_text: str) -> Dict[str, List[str]]:
        if not jd_text:
            return {"required_skills": [], "preferred_skills": []}

        text = jd_text.lower()
        candidates = self._extract_candidate_skills(text)

        required: List[str] = []
        preferred: List[str] = []

        sentences = re.split(r"[\n\r\.;]", text)
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            sentence_skills = [skill for skill in candidates if skill in sentence]
            if not sentence_skills:
                continue

            if any(hint in sentence for hint in self.PREFERRED_HINTS):
                preferred.extend(sentence_skills)
            elif any(hint in sentence for hint in self.REQUIRED_HINTS):
                required.extend(sentence_skills)
            else:
                # Default to required if section is unclear
                required.extend(sentence_skills)

        # Deduplicate while preserving order
        required = self._dedupe(required)
        preferred = [s for s in self._dedupe(preferred) if s not in required]

        return {
            "required_skills": required,
            "preferred_skills": preferred,
        }

    def extract_resume_skills(self, resume_text: str) -> List[str]:
        if not resume_text:
            return []
        text = resume_text.lower()
        skills = self._extract_candidate_skills(text)
        return self._dedupe(skills)

    def compute_jd_match(
        self,
        resume_text: str,
        jd_structured: Dict[str, List[str]],
        required_weight: float = 0.7,
        preferred_weight: float = 0.3,
    ) -> Dict:
        resume_skills = self.extract_resume_skills(resume_text)
        required = jd_structured.get("required_skills", [])
        preferred = jd_structured.get("preferred_skills", [])

        required_score, required_exact, required_semantic = self._score_skill_group(required, resume_skills)
        preferred_score, preferred_exact, preferred_semantic = self._score_skill_group(preferred, resume_skills)

        if not required and not preferred:
            return {
                "keyword_score": 0.0,
                "required_score": 0.0,
                "preferred_score": 0.0,
                "resume_skills": resume_skills,
                "exact_matches": [],
                "semantic_matches": [],
            }

        overall = (required_score * required_weight) + (preferred_score * preferred_weight)

        return {
            "keyword_score": float(round(overall, 2)),
            "required_score": float(round(required_score, 2)),
            "preferred_score": float(round(preferred_score, 2)),
            "resume_skills": resume_skills,
            "exact_matches": self._dedupe(required_exact + preferred_exact),
            "semantic_matches": self._dedupe(required_semantic + preferred_semantic),
        }

    def _extract_candidate_skills(self, text: str) -> List[str]:
        found: List[str] = []

        # Lexicon-based matching
        for skill in sorted(self.SKILL_LEXICON, key=len, reverse=True):
            if skill in text:
                found.append(skill)

        # Pattern-based extraction for technologies in comma-separated skill lines
        skill_line_matches = re.findall(r"(?:skills|technologies|tools)\s*[:\-]\s*([^\n]+)", text)
        for line in skill_line_matches:
            parts = [p.strip() for p in re.split(r",|\||/", line) if p.strip()]
            for part in parts:
                if 1 < len(part) <= 35 and re.search(r"[a-z]", part):
                    found.append(part)

        return self._dedupe([self._normalize_skill(s) for s in found if s])

    def _score_skill_group(self, jd_skills: List[str], resume_skills: List[str]) -> Tuple[float, List[str], List[str]]:
        if not jd_skills:
            return 100.0, [], []

        if not resume_skills:
            return 0.0, [], []

        exact_matches: List[str] = []
        semantic_matches: List[str] = []
        scores: List[float] = []

        normalized_resume = [self._normalize_skill(s) for s in resume_skills]

        for jd_skill in jd_skills:
            n_jd_skill = self._normalize_skill(jd_skill)
            if n_jd_skill in normalized_resume:
                exact_matches.append(n_jd_skill)
                scores.append(1.0)
                continue

            # Semantic fallback: use char-level TF-IDF embedding cosine similarity
            similarities = [self._semantic_similarity(n_jd_skill, rs) for rs in normalized_resume]
            best = max(similarities) if similarities else 0.0

            if best >= 0.65:
                semantic_matches.append(n_jd_skill)

            scores.append(best)

        group_score = float(np.mean(scores) * 100.0)
        return group_score, exact_matches, semantic_matches

    def _semantic_similarity(self, a: str, b: str) -> float:
        if not a or not b:
            return 0.0

        if a == b:
            return 1.0

        vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5))
        try:
            matrix = vectorizer.fit_transform([a, b]).toarray()
            v1, v2 = matrix[0], matrix[1]
            denom = (np.linalg.norm(v1) * np.linalg.norm(v2))
            if denom == 0:
                return 0.0
            similarity = float(np.dot(v1, v2) / denom)
            return max(0.0, min(1.0, similarity))
        except Exception:
            return 0.0

    @staticmethod
    def _normalize_skill(skill: str) -> str:
        s = re.sub(r"\s+", " ", skill.strip().lower())
        return s

    @staticmethod
    def _dedupe(items: List[str]) -> List[str]:
        seen = set()
        output = []
        for item in items:
            if item not in seen:
                seen.add(item)
                output.append(item)
        return output
