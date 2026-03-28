import json
import re
from typing import Dict, List, Tuple

import google.generativeai as genai

from app.config import settings
from app.services.jd_skill_service import JDSkillService
from app.utils.pdf_utils import check_formatting, extract_contact_info, extract_sections

# Configure Gemini once for the process
genai.configure(api_key=settings.gemini_api_key)


class ATSScorer:
    """
    Production-focused ATS scorer with:
    - Job-specific keyword scoring (required vs preferred)
    - Adaptive component weighting
    - Confidence-aware score blending
    - Penalty system for real-world ATS hygiene issues
    - Low-variance AI scoring with strict JSON validation + retries
    """

    ACTION_VERBS = {
        "built", "led", "managed", "designed", "implemented", "optimized", "delivered",
        "launched", "developed", "reduced", "improved", "increased", "streamlined",
        "automated", "analyzed", "architected", "scaled", "migrated", "deployed",
    }

    IMPACT_WORDS = {
        "increased", "reduced", "improved", "saved", "generated", "boosted",
        "optimized", "accelerated", "enhanced", "delivered", "cut", "grew",
    }

    CONFIDENCE_THRESHOLD = 0.45

    def __init__(self):
        self.jd_service = JDSkillService()
        self.model = genai.GenerativeModel("gemini-pro")

    def calculate_ats_score(
        self,
        resume_text: str,
        jd_text: str = "",
        extraction_confidence: str = "high",
        extraction_metrics: Dict = None,
    ) -> Dict:
        extraction_metrics = extraction_metrics or {}
        warnings: List[str] = []

        # If extraction quality is low, skip final score per spec
        if extraction_confidence == "low":
            return {
                "final_score": None,
                "confidence": "low",
                "component_scores": {
                    "keywords": 0.0,
                    "structure": 0.0,
                    "formatting": 0.0,
                    "experience": 0.0,
                    "ai": 0.0,
                },
                "component_confidence": {
                    "keyword_confidence": 0.0,
                    "structure_confidence": 0.0,
                    "formatting_confidence": 0.0,
                    "experience_confidence": 0.0,
                    "ai_confidence": 0.0,
                },
                "warnings": ["Low extraction confidence"],
                "suggestions": [
                    "Resume text extraction quality is low. Please upload a clearer, text-based PDF.",
                ],
                "overall_score": None,
                "keywords_score": 0.0,
                "structure_score": 0.0,
                "formatting_score": 0.0,
                "experience_score": 0.0,
                "readability_score": 0.0,
                "ai_score": 0.0,
                "found_keywords": [],
                "sections_found": [],
                "jd_skills": {"required_skills": [], "preferred_skills": []},
                "evaluation_metadata": {
                    "scoring_version": "ats_v2",
                    "has_jd": bool(jd_text),
                    "extraction_confidence": extraction_confidence,
                    "extraction_metrics": extraction_metrics,
                },
            }

        # Core extraction-driven features
        sections = extract_sections(resume_text)
        contact_info = extract_contact_info(resume_text)
        formatting_result = check_formatting(resume_text)

        structure_score, structure_conf = self._compute_structure_score(sections, contact_info)
        formatting_score, readability_score, formatting_conf = self._compute_formatting_and_readability(formatting_result, resume_text)
        experience_score, experience_conf = self._compute_experience_quality_score(resume_text)

        # JD-aware keyword scoring (with fallback)
        jd_structured = self.jd_service.extract_structured_skills(jd_text) if jd_text else {
            "required_skills": [], "preferred_skills": []
        }
        keyword_score, keyword_conf, found_keywords, skill_breakdown = self._compute_keyword_score(
            resume_text=resume_text,
            jd_structured=jd_structured,
        )

        # AI analysis with low variance + strict schema validation
        ai_analysis, ai_conf = self.get_ai_analysis(resume_text=resume_text, jd_text=jd_text)
        ai_score = float(ai_analysis.get("score", 0.0))

        # Penalty framework
        penalties, penalty_total = self._compute_penalties(
            resume_text=resume_text,
            contact_info=contact_info,
            sections=sections,
            found_keywords=found_keywords,
            jd_structured=jd_structured,
        )
        warnings.extend([p["reason"] for p in penalties])

        component_scores = {
            "keywords": keyword_score,
            "structure": structure_score,
            "formatting": formatting_score,
            "experience": experience_score,
            "ai": ai_score,
        }

        component_confidence = {
            "keyword_confidence": keyword_conf,
            "structure_confidence": structure_conf,
            "formatting_confidence": formatting_conf,
            "experience_confidence": experience_conf,
            "ai_confidence": ai_conf,
        }

        weights = self._get_adaptive_weights(has_jd=bool(jd_text), extraction_confidence=extraction_confidence)

        final_score = self._blend_score_with_confidence(
            component_scores=component_scores,
            component_confidence=component_confidence,
            weights=weights,
            warnings=warnings,
        )

        final_score = max(0.0, min(100.0, final_score - penalty_total))

        overall_confidence = self._derive_overall_confidence(
            extraction_confidence=extraction_confidence,
            component_confidence=component_confidence,
        )

        suggestions = self._generate_suggestions(
            sections=sections,
            contact_info=contact_info,
            formatting_result=formatting_result,
            ai_analysis=ai_analysis,
            penalties=penalties,
            keyword_score=keyword_score,
        )

        return {
            "final_score": round(final_score, 2),
            "confidence": overall_confidence,
            "component_scores": {
                "keywords": round(keyword_score, 2),
                "structure": round(structure_score, 2),
                "formatting": round(formatting_score, 2),
                "experience": round(experience_score, 2),
                "ai": round(ai_score, 2),
            },
            "component_confidence": {
                "keyword_confidence": round(keyword_conf, 3),
                "structure_confidence": round(structure_conf, 3),
                "formatting_confidence": round(formatting_conf, 3),
                "experience_confidence": round(experience_conf, 3),
                "ai_confidence": round(ai_conf, 3),
            },
            "warnings": warnings,
            "suggestions": suggestions,
            # Compatibility fields for existing consumers
            "overall_score": round(final_score, 2),
            "keywords_score": round(keyword_score, 2),
            "structure_score": round(structure_score, 2),
            "formatting_score": round(formatting_score, 2),
            "experience_score": round(experience_score, 2),
            "readability_score": round(readability_score, 2),
            "ai_score": round(ai_score, 2),
            "ai_analysis": ai_analysis,
            "found_keywords": found_keywords,
            "sections_found": list(sections.keys()),
            "jd_skills": jd_structured,
            "jd_skill_breakdown": skill_breakdown,
            "evaluation_metadata": {
                "scoring_version": "ats_v2",
                "has_jd": bool(jd_text),
                "extraction_confidence": extraction_confidence,
                "weights": weights,
                "penalties": penalties,
                "extraction_metrics": extraction_metrics,
            },
        }

    def get_ai_analysis(self, resume_text: str, jd_text: str = "") -> Tuple[Dict, float]:
        """
        Deterministic, low-variance Gemini scoring.
        - strict JSON schema validation
        - retries up to 2 times (3 attempts total)
        - temperature fixed to 0.1
        """
        if not settings.gemini_api_key or settings.gemini_api_key == "your_gemini_api_key_here":
            return {
                "score": 60,
                "formatting_issues": ["Gemini API key not configured"],
                "missing_sections": [],
                "keyword_suggestions": [],
                "improvements": [],
            }, 0.2

        prompt = f"""
You are an ATS scoring assistant. Return ONLY valid JSON.

Analyze this resume for ATS quality.
If JD is provided, evaluate JD relevance strongly.

REQUIRED JSON SCHEMA:
{{
  "score": <number between 0 and 100>,
  "formatting_issues": ["..."],
  "missing_sections": ["..."],
  "keyword_suggestions": ["..."],
  "improvements": ["..."]
}}

JD (optional):
{jd_text[:1500] if jd_text else "N/A"}

Resume:
{resume_text[:3500]}
"""

        for attempt in range(3):
            try:
                response = self.model.generate_content(
                    prompt,
                    generation_config={"temperature": 0.1},
                )
                parsed = self._parse_json_response(response.text)
                if self._validate_ai_schema(parsed):
                    ai_conf = 0.85 if attempt == 0 else 0.65
                    return parsed, ai_conf
            except Exception:
                continue

        # Safe fallback if Gemini output keeps failing schema validation
        return {
            "score": 60,
            "formatting_issues": [],
            "missing_sections": [],
            "keyword_suggestions": [],
            "improvements": ["AI analysis could not be validated; using fallback score."],
        }, 0.35

    def _compute_structure_score(self, sections: Dict, contact_info: Dict) -> Tuple[float, float]:
        required_sections = ["experience", "education", "skills"]
        optional_sections = ["projects", "summary", "certifications"]

        required_hits = sum(1 for s in required_sections if s in sections)
        optional_hits = sum(1 for s in optional_sections if s in sections)

        base = (required_hits / len(required_sections)) * 80.0
        bonus = min(20.0, (optional_hits / len(optional_sections)) * 20.0)

        if contact_info.get("has_email"):
            bonus += 4
        if contact_info.get("has_phone"):
            bonus += 4

        score = min(100.0, base + bonus)
        confidence = min(1.0, 0.45 + (required_hits * 0.15) + (optional_hits * 0.08))
        return score, confidence

    def _compute_formatting_and_readability(self, formatting_result: Dict, resume_text: str) -> Tuple[float, float, float]:
        formatting_score = float(formatting_result.get("score", 0.0))
        word_count = len(re.findall(r"\b\w+\b", resume_text))

        if 350 <= word_count <= 900:
            readability_score = 100.0
        elif word_count < 350:
            readability_score = max(40.0, (word_count / 350) * 100.0)
        else:
            readability_score = max(55.0, 100.0 - ((word_count - 900) / 30.0))

        combined_formatting = (formatting_score * 0.7) + (readability_score * 0.3)
        issue_count = len(formatting_result.get("issues", []))
        confidence = max(0.3, min(0.95, 0.9 - (issue_count * 0.08)))

        return combined_formatting, readability_score, confidence

    def _compute_experience_quality_score(self, resume_text: str) -> Tuple[float, float]:
        lines = [line.strip() for line in resume_text.splitlines() if line.strip()]
        bullet_lines = [line for line in lines if re.match(r"^[\-•*▪]\s+", line)]

        # Fallback: if no explicit bullets, use sentence-like chunks from experience section
        if not bullet_lines:
            bullet_lines = [line for line in lines if len(line.split()) >= 8][:8]

        if not bullet_lines:
            return 30.0, 0.3

        metric_pattern = re.compile(r"(\d+\s?%|\$\s?\d+[\dkm]?|\d+\s?(x|times|hrs|hours|days|months)|\d{2,})", re.IGNORECASE)

        bullet_scores = []
        for line in bullet_lines[:15]:
            text = line.lower()
            has_action = any(verb in text for verb in self.ACTION_VERBS)
            has_metric = bool(metric_pattern.search(text))
            has_impact = any(word in text for word in self.IMPACT_WORDS)
            score = ((1 if has_action else 0) + (1 if has_metric else 0) + (1 if has_impact else 0)) / 3.0
            bullet_scores.append(score * 100)

        experience_score = sum(bullet_scores) / len(bullet_scores)
        confidence = min(1.0, 0.35 + (len(bullet_scores) * 0.08))
        return experience_score, confidence

    def _compute_keyword_score(self, resume_text: str, jd_structured: Dict[str, List[str]]) -> Tuple[float, float, List[str], Dict]:
        has_jd = bool(jd_structured.get("required_skills") or jd_structured.get("preferred_skills"))

        if has_jd:
            jd_result = self.jd_service.compute_jd_match(
                resume_text=resume_text,
                jd_structured=jd_structured,
                required_weight=0.7,
                preferred_weight=0.3,
            )
            required_count = len(jd_structured.get("required_skills", []))
            preferred_count = len(jd_structured.get("preferred_skills", []))
            total_jd = required_count + preferred_count
            confidence = min(1.0, 0.45 + (total_jd * 0.04))
            return (
                float(jd_result.get("keyword_score", 0.0)),
                confidence,
                jd_result.get("resume_skills", []),
                jd_result,
            )

        # Generic fallback scoring when JD is absent
        resume_skills = self.jd_service.extract_resume_skills(resume_text)
        unique_skill_count = len(resume_skills)

        # Prefer keyword quality (diversity) over raw quantity
        generic_score = min(100.0, (unique_skill_count / 18.0) * 100.0)
        confidence = max(0.35, min(0.9, unique_skill_count / 14.0))

        return generic_score, confidence, resume_skills, {
            "required_score": None,
            "preferred_score": None,
            "exact_matches": [],
            "semantic_matches": [],
        }

    def _compute_penalties(
        self,
        resume_text: str,
        contact_info: Dict,
        sections: Dict,
        found_keywords: List[str],
        jd_structured: Dict[str, List[str]],
    ) -> Tuple[List[Dict], float]:
        penalties: List[Dict] = []

        # Missing contact info penalties
        if not contact_info.get("has_email"):
            penalties.append({"reason": "Missing email contact", "value": 5.0})
        if not contact_info.get("has_phone"):
            penalties.append({"reason": "Missing phone contact", "value": 4.0})

        # Missing experience dates
        has_years = bool(re.search(r"\b(19|20)\d{2}\b", resume_text))
        if "experience" in sections and not has_years:
            penalties.append({"reason": "Experience section missing dates", "value": 5.0})

        # No projects section for fresher profiles
        fresher_hint = bool(re.search(r"\b(fresher|entry\s*level|student|graduate|intern)\b", resume_text.lower()))
        if fresher_hint and "projects" not in sections:
            penalties.append({"reason": "Projects section missing for fresher profile", "value": 4.0})

        # Keyword stuffing detection
        stuffing_penalty = self._keyword_stuffing_penalty(resume_text, found_keywords, jd_structured)
        if stuffing_penalty > 0:
            penalties.append({"reason": "Possible keyword stuffing detected", "value": stuffing_penalty})

        total = sum(p["value"] for p in penalties)
        return penalties, total

    def _keyword_stuffing_penalty(
        self,
        resume_text: str,
        found_keywords: List[str],
        jd_structured: Dict[str, List[str]],
    ) -> float:
        text = resume_text.lower()
        targets = set(found_keywords)
        targets.update(jd_structured.get("required_skills", []))
        targets.update(jd_structured.get("preferred_skills", []))

        penalty = 0.0
        for keyword in targets:
            if not keyword or len(keyword) < 3:
                continue
            occurrences = len(re.findall(rf"\b{re.escape(keyword.lower())}\b", text))
            if occurrences > 8:
                penalty += min(12.0, (occurrences - 8) * 0.9)

        return min(15.0, penalty)

    def _get_adaptive_weights(self, has_jd: bool, extraction_confidence: str) -> Dict[str, float]:
        if has_jd:
            base = {
                "keywords": 0.58,
                "structure": 0.18,
                "formatting": 0.16,
                "experience": 0.14,
                "ai": 0.35,
            }
        else:
            base = {
                "keywords": 0.36,
                "structure": 0.22,
                "formatting": 0.21,
                "experience": 0.24,
                "ai": 0.32,
            }

        # AI contribution cap policy
        if extraction_confidence == "medium":
            base["ai"] = min(base["ai"], 0.30)
        elif extraction_confidence == "low":
            base["ai"] = min(base["ai"], 0.10)
        else:
            base["ai"] = min(base["ai"], 0.40)

        return base

    def _blend_score_with_confidence(
        self,
        component_scores: Dict[str, float],
        component_confidence: Dict[str, float],
        weights: Dict[str, float],
        warnings: List[str],
    ) -> float:
        effective_weights: Dict[str, float] = {}

        confidence_key_map = {
            "keywords": "keyword_confidence",
            "structure": "structure_confidence",
            "formatting": "formatting_confidence",
            "experience": "experience_confidence",
            "ai": "ai_confidence",
        }

        for component, raw_weight in weights.items():
            c_key = confidence_key_map[component]
            conf = float(component_confidence.get(c_key, 0.0))

            if conf >= self.CONFIDENCE_THRESHOLD:
                effective_weights[component] = raw_weight
            else:
                # Reduce influence when confidence is low
                effective_weights[component] = raw_weight * max(0.1, conf)
                warnings.append(f"Reduced influence of {component} due to low confidence")

        weight_sum = sum(effective_weights.values())
        if weight_sum == 0:
            return 0.0

        blended = 0.0
        for component, weight in effective_weights.items():
            blended += float(component_scores.get(component, 0.0)) * weight

        return blended / weight_sum

    def _derive_overall_confidence(self, extraction_confidence: str, component_confidence: Dict[str, float]) -> str:
        if extraction_confidence == "low":
            return "low"

        avg_component_conf = sum(component_confidence.values()) / max(len(component_confidence), 1)
        extraction_factor = {"high": 0.9, "medium": 0.65, "low": 0.3}.get(extraction_confidence, 0.5)
        combined = (avg_component_conf * 0.7) + (extraction_factor * 0.3)

        if combined >= 0.75:
            return "high"
        if combined >= 0.5:
            return "medium"
        return "low"

    def _generate_suggestions(
        self,
        sections: Dict,
        contact_info: Dict,
        formatting_result: Dict,
        ai_analysis: Dict,
        penalties: List[Dict],
        keyword_score: float,
    ) -> List[str]:
        suggestions: List[str] = []

        # Penalty-driven suggestions first
        for penalty in penalties:
            reason = penalty.get("reason", "")
            if "email" in reason.lower():
                suggestions.append("Add a professional email in the resume header")
            elif "phone" in reason.lower():
                suggestions.append("Add a phone number for recruiter contact")
            elif "dates" in reason.lower():
                suggestions.append("Add clear date ranges for each experience entry")
            elif "projects" in reason.lower():
                suggestions.append("Add a Projects section with impact-focused project bullets")
            elif "stuffing" in reason.lower():
                suggestions.append("Avoid repeating the same keywords excessively; use context-rich bullets")

        # Structural suggestions
        if "experience" not in sections:
            suggestions.append("Add an Experience section with role-wise achievements")
        if "skills" not in sections:
            suggestions.append("Add a dedicated Skills section with role-relevant technologies")
        if "education" not in sections:
            suggestions.append("Include Education details with degree and graduation year")

        # Formatting suggestions
        for issue in formatting_result.get("issues", [])[:2]:
            suggestions.append(issue)

        # Keyword quality suggestions
        if keyword_score < 55:
            suggestions.append("Improve skill-to-role alignment by adding job-relevant technical keywords")

        # AI suggestions
        for suggestion in ai_analysis.get("improvements", [])[:3]:
            if suggestion not in suggestions:
                suggestions.append(suggestion)

        # Dedupe and cap
        deduped = []
        seen = set()
        for suggestion in suggestions:
            if suggestion and suggestion not in seen:
                seen.add(suggestion)
                deduped.append(suggestion)

        return deduped[:10]

    def _parse_json_response(self, response_text: str) -> Dict:
        text = (response_text or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()

        # Try direct parse
        try:
            return json.loads(text)
        except Exception:
            pass

        # Try extracting largest JSON object block
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start:end + 1])

        raise ValueError("AI response is not valid JSON")

    def _validate_ai_schema(self, data: Dict) -> bool:
        required_keys = {
            "score": (int, float),
            "formatting_issues": list,
            "missing_sections": list,
            "keyword_suggestions": list,
            "improvements": list,
        }

        for key, expected_type in required_keys.items():
            if key not in data:
                return False
            if not isinstance(data[key], expected_type):
                return False

        score = float(data["score"])
        if score < 0 or score > 100:
            return False

        return True
