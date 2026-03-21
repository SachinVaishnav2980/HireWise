import asyncio
from datetime import datetime
import json
import os
import re
import tempfile
from typing import Any, Dict, List, Optional

import google.generativeai as genai
import httpx
from bson import ObjectId
from docx import Document
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, HttpUrl

from app.config import settings
from app.database import get_db
from app.utils.pdf_utils import extract_text_from_pdf

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

ROLE_KEYWORDS = {
    "GenAI Engineer": ["gen ai", "generative ai", "llm", "rag", "langchain", "prompt engineering", "vector database", "embedding", "fine-tuning", "openai", "gemini"],
    "Machine Learning Engineer": ["machine learning", "ml", "model deployment", "model serving", "feature engineering", "scikit", "tensorflow", "pytorch", "xgboost"],
    "AI Engineer": ["ai engineer", "deep learning", "nlp", "computer vision", "transformer", "inference", "model optimization"],
    "Software Engineer": ["software engineer", "developer", "python", "java", "javascript", "typescript", "api", "git", "oop", "dsa"],
    "Backend Developer": ["backend", "fastapi", "django", "flask", "spring", "node", "express", "rest", "microservices", "sql", "mongodb"],
    "Frontend Developer": ["frontend", "react", "next", "vue", "angular", "html", "css", "tailwind", "typescript", "ui"],
    "Full Stack Developer": ["full stack", "frontend", "backend", "react", "node", "api", "database", "mongodb", "postgres", "deployment"],
    "Content Editor": ["editor", "editing", "copy editing", "proofreading", "style guide", "fact checking", "cms", "content publishing", "editorial"],
    "Video Editor": ["video editor", "premiere pro", "final cut", "davinci resolve", "storyboarding", "color grading", "motion graphics"],
    "Copywriter": ["copywriter", "copywriting", "seo writing", "blog writing", "content strategy", "headline", "brand voice"],
    "Data Analyst": ["sql", "excel", "tableau", "power bi", "analytics", "dashboard", "reporting", "kpi", "business intelligence"],
    "Data Scientist": ["machine learning", "deep learning", "tensorflow", "pytorch", "nlp", "statistics", "scikit", "model training"],
    "DevOps Engineer": ["aws", "azure", "docker", "kubernetes", "ci/cd", "jenkins", "terraform", "linux"],
    "Product Manager": ["roadmap", "stakeholder", "agile", "scrum", "requirement", "market", "product"],
    "UI/UX Designer": ["figma", "wireframe", "prototype", "user research", "design system", "ux", "ui"],
    "QA Engineer": ["testing", "selenium", "cypress", "automation", "test case", "quality assurance"],
    "Business Analyst": ["business analyst", "requirements gathering", "brd", "frd", "gap analysis", "stakeholder management", "process mapping"],
}

ROLE_FAMILIES = {
    "ai": {"GenAI Engineer", "Machine Learning Engineer", "AI Engineer", "Data Scientist"},
    "developer": {"Software Engineer", "Backend Developer", "Frontend Developer", "Full Stack Developer", "DevOps Engineer", "QA Engineer"},
    "content": {"Content Editor", "Video Editor", "Copywriter", "UI/UX Designer"},
    "business": {"Business Analyst", "Product Manager", "Data Analyst"},
}

if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)


class JobApplyRequest(BaseModel):
    user_id: str
    job_title: str
    company: str
    source: str
    job_url: HttpUrl
    location: Optional[str] = None


def _extract_text_from_docx(file_path: str) -> str:
    try:
        doc = Document(file_path)
        return "\n".join([p.text for p in doc.paragraphs if p.text]).strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read DOCX file: {str(exc)}")


async def _extract_resume_text(upload_file: UploadFile) -> str:
    file_name = upload_file.filename or "resume"
    extension = os.path.splitext(file_name)[1].lower()
    if extension not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX resumes are supported")

    temp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as tmp:
            temp_path = tmp.name
            content = await upload_file.read()
            tmp.write(content)

        if extension == ".pdf":
            text = extract_text_from_pdf(temp_path)
        else:
            text = _extract_text_from_docx(temp_path)

        if not text or len(text.strip()) < 40:
            raise HTTPException(status_code=400, detail="Could not extract enough text from the uploaded resume")
        return text
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


def _infer_roles_from_resume(resume_text: str, max_roles: int = 5) -> List[str]:
    text = resume_text.lower()
    scored_roles = []

    for role, keywords in ROLE_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in text)
        if score > 0:
            scored_roles.append((role, score))

    scored_roles.sort(key=lambda item: item[1], reverse=True)
    return [role for role, _ in scored_roles[:max_roles]]


def _keyword_role_scores(resume_text: str) -> Dict[str, int]:
    text = resume_text.lower()
    scores: Dict[str, int] = {}
    for role, keywords in ROLE_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            pattern = r"\b" + re.escape(keyword.lower()) + r"\b"
            if re.search(pattern, text):
                # Give extra weight to explicit role titles to stabilize matching.
                score += 2 if " " in keyword and len(keyword) > 8 else 1
        scores[role] = score
    return scores


def _family_score(keyword_scores: Dict[str, int], family_name: str) -> int:
    roles = ROLE_FAMILIES.get(family_name, set())
    return sum(keyword_scores.get(role, 0) for role in roles)


def _sanitize_text(value: str) -> str:
    text = value or ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_json_array(raw_text: str) -> List[str]:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        chunks = cleaned.split("```")
        if len(chunks) >= 2:
            cleaned = chunks[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        if isinstance(parsed, dict) and isinstance(parsed.get("roles"), list):
            return [str(item).strip() for item in parsed["roles"] if str(item).strip()]
    except Exception:
        pass

    return []


def _infer_roles_with_gemini_sync(resume_text: str, max_roles: int = 5) -> List[str]:
    if not settings.gemini_api_key:
        return []

    prompt = f"""
You are a career assistant. Analyze the following resume text and return ONLY a JSON array of the top {max_roles} most suitable job roles.

Requirements:
- Return only role titles
- No explanation
- No markdown
- Prioritize software development roles when resume evidence is mostly coding/backend/frontend/project development
- Prioritize GenAI/ML roles when resume shows LLM, RAG, prompt engineering, model training/deployment work
- Prioritize editor/content roles when resume shows editing/proofreading/copy/content publishing work
- Suggest Data Scientist role only when clear ML/statistics/model-building evidence exists
- Example output: ["Software Engineer", "Backend Developer"]

Resume Text:
{resume_text[:7000]}
"""

    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(prompt)
    response_text = getattr(response, "text", "") or ""
    roles = _extract_json_array(response_text)
    normalized = []
    for role in roles:
        role = role.strip()
        if role and role.lower() not in [r.lower() for r in normalized]:
            normalized.append(role)
    return normalized[:max_roles]


def _merge_role_signals(gemini_roles: List[str], resume_text: str, max_roles: int = 5) -> List[str]:
    keyword_scores = _keyword_role_scores(resume_text)
    ai_strength = _family_score(keyword_scores, "ai")
    dev_strength = _family_score(keyword_scores, "developer")
    content_strength = _family_score(keyword_scores, "content")
    business_strength = _family_score(keyword_scores, "business")

    candidate_roles = set(keyword_scores.keys())
    candidate_roles.update(gemini_roles)

    combined_scores: Dict[str, float] = {}
    for role in candidate_roles:
        keyword_score = float(keyword_scores.get(role, 0))
        gemini_bonus = 0.0
        if role in gemini_roles:
            gemini_rank = gemini_roles.index(role)
            gemini_bonus = max(6.0 - (gemini_rank * 1.0), 2.0)
        combined_scores[role] = (keyword_score * 1.2) + gemini_bonus

    # Guardrail: prevent DS from ranking high without clear ML evidence.
    ds_score = keyword_scores.get("Data Scientist", 0)
    if ds_score < 2 and "Data Scientist" in combined_scores:
        combined_scores["Data Scientist"] -= 2.5

    # Family-aware guardrails to avoid wrong dominant domain predictions.
    if ai_strength >= 3:
        for role in ROLE_FAMILIES["ai"]:
            if role in combined_scores:
                combined_scores[role] += 2.0

    if content_strength >= 2 and dev_strength < 3:
        for role in ROLE_FAMILIES["content"]:
            if role in combined_scores:
                combined_scores[role] += 2.0
        if "Business Analyst" in combined_scores and business_strength <= 1:
            combined_scores["Business Analyst"] -= 2.0

    if dev_strength >= 3:
        for role in ROLE_FAMILIES["developer"]:
            if role in combined_scores:
                combined_scores[role] += 1.5

    ranked = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)

    result: List[str] = []
    for role, score in ranked:
        if score <= 0:
            continue
        if role not in result:
            result.append(role)
        if len(result) >= max_roles:
            break

    if result:
        return result

    return _infer_roles_from_resume(resume_text, max_roles)


async def _infer_roles_from_resume_with_gemini(resume_text: str, max_roles: int = 5) -> List[str]:
    gemini_roles: List[str] = []
    try:
        gemini_roles = await asyncio.to_thread(_infer_roles_with_gemini_sync, resume_text, max_roles)
    except Exception:
        gemini_roles = []

    return _merge_role_signals(gemini_roles, resume_text, max_roles)


def _normalize_job(job: Dict[str, Any], source: str) -> Dict[str, Any]:
    url = (job.get("url") or "").strip()
    if not url.startswith("http"):
        url = ""

    return {
        "job_id": job.get("job_id") or job.get("id") or f"{source}-{abs(hash((job.get('title'), job.get('company'), job.get('url'))))}",
        "title": job.get("title", "Unknown Role"),
        "company": job.get("company", "Unknown Company"),
        "location": job.get("location") or "Not specified",
        "description": _sanitize_text(job.get("description") or "")[:450],
        "employment_type": job.get("employment_type") or "Not specified",
        "is_remote": bool(job.get("is_remote", False)),
        "url": url,
        "source": source,
        "posted_at": str(job.get("posted_at") or ""),
    }


def _dedupe_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    unique_jobs = []
    for job in jobs:
        key = (job.get("url"), job.get("title"), job.get("company"))
        if key in seen:
            continue
        seen.add(key)
        unique_jobs.append(job)
    return unique_jobs


def _filter_real_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        job for job in jobs
        if job.get("url", "").startswith("http")
        and job.get("title")
        and job.get("company")
    ]


def _interleave_jobs_by_source(jobs: List[Dict[str, Any]], limit: int = 60) -> List[Dict[str, Any]]:
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for job in jobs:
        source = job.get("source", "Unknown")
        buckets.setdefault(source, []).append(job)

    for source in buckets:
        buckets[source].sort(key=lambda item: item.get("posted_at") or "", reverse=True)

    ordered_sources = sorted(buckets.keys(), key=lambda src: len(buckets[src]), reverse=True)
    mixed: List[Dict[str, Any]] = []

    while len(mixed) < limit:
        progressed = False
        for source in ordered_sources:
            if buckets[source]:
                mixed.append(buckets[source].pop(0))
                progressed = True
                if len(mixed) >= limit:
                    break
        if not progressed:
            break

    return mixed


def _score_job_against_roles(job: Dict[str, Any], roles: List[str]) -> int:
    if not roles:
        return 0
    haystack = f"{job.get('title', '')} {job.get('description', '')}".lower()
    role_score = 0
    for role in roles:
        role_words = role.lower().split()
        role_score += sum(1 for word in role_words if word in haystack)
    return role_score


async def _fetch_jsearch(client: httpx.AsyncClient, query: str, location: str, page: int) -> List[Dict[str, Any]]:
    if not settings.jsearch_api_key:
        return []

    endpoint = "https://jsearch.p.rapidapi.com/search"
    search_query = query if not location else f"{query} in {location}"
    headers = {
        "X-RapidAPI-Key": settings.jsearch_api_key,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    }

    try:
        response = await client.get(endpoint, params={"query": search_query, "page": page, "num_pages": 1}, headers=headers)
        response.raise_for_status()
        payload = response.json()
        normalized = []
        for item in payload.get("data", [])[:25]:
            normalized.append(_normalize_job({
                "job_id": item.get("job_id"),
                "title": item.get("job_title"),
                "company": item.get("employer_name"),
                "location": item.get("job_city") or item.get("job_country"),
                "description": item.get("job_description"),
                "employment_type": item.get("job_employment_type"),
                "is_remote": item.get("job_is_remote", False),
                "url": item.get("job_apply_link") or item.get("job_google_link"),
                "posted_at": item.get("job_posted_at_datetime_utc"),
            }, "JSearch"))
        return normalized
    except Exception:
        return []


async def _fetch_adzuna(client: httpx.AsyncClient, query: str, location: str, page: int) -> List[Dict[str, Any]]:
    if not settings.adzuna_app_id or not settings.adzuna_app_key:
        return []

    country = settings.adzuna_country or "in"
    endpoint = f"https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"

    params = {
        "app_id": settings.adzuna_app_id,
        "app_key": settings.adzuna_app_key,
        "what": query,
        "results_per_page": 20,
    }
    if location:
        params["where"] = location

    try:
        response = await client.get(endpoint, params=params)
        response.raise_for_status()
        payload = response.json()
        normalized = []
        for item in payload.get("results", []):
            normalized.append(_normalize_job({
                "job_id": str(item.get("id")),
                "title": item.get("title"),
                "company": (item.get("company") or {}).get("display_name"),
                "location": (item.get("location") or {}).get("display_name"),
                "description": item.get("description"),
                "employment_type": item.get("contract_time") or item.get("contract_type"),
                "is_remote": "remote" in (item.get("title", "") + " " + item.get("description", "")).lower(),
                "url": item.get("redirect_url"),
                "posted_at": item.get("created"),
            }, "Adzuna"))
        return normalized
    except Exception:
        return []


async def _fetch_remotive(client: httpx.AsyncClient, query: str) -> List[Dict[str, Any]]:
    endpoint = "https://remotive.com/api/remote-jobs"
    try:
        response = await client.get(endpoint, params={"search": query})
        response.raise_for_status()
        payload = response.json()
        normalized = []
        for item in payload.get("jobs", [])[:25]:
            normalized.append(_normalize_job({
                "job_id": str(item.get("id")),
                "title": item.get("title"),
                "company": item.get("company_name"),
                "location": item.get("candidate_required_location") or "Remote",
                "description": item.get("description"),
                "employment_type": item.get("job_type"),
                "is_remote": True,
                "url": item.get("url"),
                "posted_at": item.get("publication_date"),
            }, "Remotive"))
        return normalized
    except Exception:
        return []


async def _fetch_arbeitnow(client: httpx.AsyncClient, query: str) -> List[Dict[str, Any]]:
    endpoint = "https://www.arbeitnow.com/api/job-board-api"
    try:
        response = await client.get(endpoint)
        response.raise_for_status()
        payload = response.json()
        normalized = []
        query_lower = query.lower()

        for item in payload.get("data", [])[:150]:
            title = item.get("title", "")
            description = _sanitize_text(item.get("description", ""))
            if query_lower not in f"{title} {description}".lower():
                continue

            normalized.append(_normalize_job({
                "job_id": str(item.get("slug") or item.get("id") or title),
                "title": title,
                "company": item.get("company_name"),
                "location": item.get("location"),
                "description": description,
                "employment_type": "Full-time",
                "is_remote": bool(item.get("remote", False)),
                "url": item.get("url"),
                "posted_at": item.get("created_at"),
            }, "Arbeitnow"))

            if len(normalized) >= 25:
                break

        return normalized
    except Exception:
        return []


async def _fetch_the_muse(client: httpx.AsyncClient, query: str, page: int) -> List[Dict[str, Any]]:
    endpoint = "https://www.themuse.com/api/public/jobs"
    try:
        response = await client.get(endpoint, params={"page": page})
        response.raise_for_status()
        payload = response.json()
        normalized = []
        query_lower = query.lower()

        for item in payload.get("results", []):
            title = item.get("name", "")
            contents = _sanitize_text(item.get("contents", ""))
            if query_lower not in f"{title} {contents}".lower():
                continue

            locations = ", ".join([loc.get("name", "") for loc in item.get("locations", []) if loc.get("name")])
            refs = item.get("refs") or {}

            normalized.append(_normalize_job({
                "job_id": str(item.get("id")),
                "title": title,
                "company": (item.get("company") or {}).get("name"),
                "location": locations or "Not specified",
                "description": contents,
                "employment_type": "Not specified",
                "is_remote": "remote" in title.lower() or "remote" in contents.lower(),
                "url": refs.get("landing_page"),
                "posted_at": item.get("publication_date"),
            }, "The Muse"))

            if len(normalized) >= 25:
                break

        return normalized
    except Exception:
        return []


@router.post("/discover")
async def discover_jobs(
    user_id: Optional[str] = Form(None),
    query: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    remote_only: bool = Form(False),
    use_resume: bool = Form(False),
    resume_id: Optional[str] = Form(None),
    page: int = Form(1),
    resume_file: Optional[UploadFile] = File(None),
    db=Depends(get_db),
):
    """Discover real jobs from multiple providers with optional resume analysis."""
    if page < 1:
        page = 1

    resume_text = ""
    used_resume = False

    if use_resume and resume_file:
        resume_text = await _extract_resume_text(resume_file)
        used_resume = True

        if user_id:
            resume_doc = {
                "user_id": user_id,
                "file_name": resume_file.filename,
                "file_type": resume_file.content_type or "application/octet-stream",
                "file_path": None,
                "extracted_text": resume_text[:10000],
                "uploaded_at": datetime.utcnow(),
                "source": "jobs_portal",
            }
            await db.resumes.insert_one(resume_doc)

    elif use_resume and resume_id and user_id:
        try:
            selected_resume = await db.resumes.find_one({"_id": ObjectId(resume_id), "user_id": user_id})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid resume ID")

        if not selected_resume:
            raise HTTPException(status_code=404, detail="Selected resume not found")

        resume_text = selected_resume.get("extracted_text", "")
        if resume_text:
            used_resume = True

    elif use_resume and user_id:
        latest_resume = await db.resumes.find_one({"user_id": user_id}, sort=[("uploaded_at", -1)])
        if latest_resume and latest_resume.get("extracted_text"):
            resume_text = latest_resume.get("extracted_text", "")
            used_resume = True

    inferred_roles = await _infer_roles_from_resume_with_gemini(resume_text) if resume_text else []

    effective_query = (query or "").strip()
    search_terms: List[str] = []
    if effective_query:
        search_terms.append(effective_query)
    if inferred_roles:
        search_terms.extend(inferred_roles[:3])

    if not search_terms:
        search_terms = ["software engineer"]

    unique_terms = []
    seen_terms = set()
    for term in search_terms:
        key = term.strip().lower()
        if key and key not in seen_terms:
            seen_terms.add(key)
            unique_terms.append(term.strip())

    async with httpx.AsyncClient(timeout=12.0) as client:
        fetch_tasks = []
        for term in unique_terms:
            fetch_tasks.append(_fetch_jsearch(client, term, location or "", page))
            fetch_tasks.append(_fetch_adzuna(client, term, location or "", page))
            # Public providers (no keys required) to diversify platform results.
            fetch_tasks.append(_fetch_remotive(client, term))
            fetch_tasks.append(_fetch_arbeitnow(client, term))
            fetch_tasks.append(_fetch_the_muse(client, term, page))
        provider_jobs = await asyncio.gather(*fetch_tasks)

    jobs = []
    for provider_result in provider_jobs:
        jobs.extend(provider_result)

    jobs = _filter_real_jobs(_dedupe_jobs(jobs))

    if remote_only:
        jobs = [job for job in jobs if job.get("is_remote")]

    if location:
        location_lower = location.lower()
        jobs = [
            job for job in jobs
            if location_lower in (job.get("location", "").lower()) or job.get("is_remote")
        ]

    for job in jobs:
        job["match_score"] = _score_job_against_roles(job, inferred_roles)

    jobs.sort(key=lambda item: (item.get("match_score", 0), item.get("posted_at") or ""), reverse=True)
    jobs = _interleave_jobs_by_source(jobs, limit=60)

    source_counts: Dict[str, int] = {}
    for job in jobs:
        source = job.get("source", "Unknown")
        source_counts[source] = source_counts.get(source, 0) + 1

    return {
        "success": True,
        "data": {
            "used_resume": used_resume,
            "recommended_roles": inferred_roles,
            "query": unique_terms[0] if unique_terms else "software engineer",
            "search_terms": unique_terms,
            "jobs": jobs,
            "total": len(jobs),
            "source_counts": source_counts,
        },
        "message": "Jobs fetched successfully",
    }


@router.post("/apply")
async def apply_to_job(request: JobApplyRequest, db=Depends(get_db)):
    """Store user job application action."""
    existing = await db.user_job_applications.find_one(
        {"user_id": request.user_id, "job_url": str(request.job_url)}
    )
    if existing:
        return {
            "success": True,
            "data": {
                "applicationId": str(existing["_id"]),
            },
            "message": "You already applied to this job",
        }

    application_doc = {
        "user_id": request.user_id,
        "job_title": request.job_title,
        "company": request.company,
        "source": request.source,
        "job_url": str(request.job_url),
        "location": request.location,
        "applied_at": datetime.utcnow(),
    }

    result = await db.user_job_applications.insert_one(application_doc)
    return {
        "success": True,
        "data": {
            "applicationId": str(result.inserted_id),
        },
        "message": "Application saved successfully",
    }


@router.get("/applications/{user_id}")
async def get_user_applications(user_id: str, db=Depends(get_db)):
    """Get all jobs applied by the user."""
    applications = []
    async for item in db.user_job_applications.find({"user_id": user_id}).sort("applied_at", -1):
        applications.append(
            {
                "applicationId": str(item["_id"]),
                "jobTitle": item.get("job_title"),
                "company": item.get("company"),
                "source": item.get("source"),
                "jobUrl": item.get("job_url"),
                "location": item.get("location"),
                "appliedAt": item.get("applied_at").isoformat() if item.get("applied_at") else None,
            }
        )

    return {
        "success": True,
        "data": applications,
        "message": f"Found {len(applications)} application(s)",
    }
