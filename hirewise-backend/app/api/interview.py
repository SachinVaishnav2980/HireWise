"""
Interview API router - Vapi voice interview endpoints only.

All endpoints are mounted under ``/api/interview``.
Interviews are stored in a dedicated ``user_interviews`` MongoDB collection,
each document linked to a ``user_id``.
"""

import os
import uuid
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from app.database import get_db
from app.config import settings
from app.services.interview_voice import (
    extract_text_from_bytes,
    generate_voice_report,
    build_vapi_assistant_config,
)

router = APIRouter(prefix="/api/interview", tags=["Interview"])

# ---------------------------------------------------------------------------
# MongoDB collection
# ---------------------------------------------------------------------------

COLLECTION = "user_interviews"

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class VapiReportRequest(BaseModel):
    session_id: str
    transcript: list  # [{role, text}, ...]


# ---------------------------------------------------------------------------
# Voice Interview - start
# ---------------------------------------------------------------------------


@router.post("/vapi/start")
async def vapi_start(
    job_description: str = Form(...),
    candidate_name: str = Form("Candidate"),
    user_id: str = Form(...),
    resume_id: Optional[str] = Form(None),
    resume: Optional[UploadFile] = File(None),
    resume_text: Optional[str] = Form(None),
    db=Depends(get_db),
):
    """Start a Vapi voice interview session.

    The caller can supply the resume in three ways (checked in order):
    1. ``resume_id`` - ID of an existing resume already stored in MongoDB.
    2. ``resume`` - an uploaded file (PDF / TXT).
    3. ``resume_text`` - pasted plain text.
    """
    candidate_name = candidate_name.strip() or "Candidate"
    job_description = job_description.strip()

    if not job_description:
        raise HTTPException(status_code=400, detail="Job description is required.")

    # ---- Resolve resume text ------------------------------------------------
    r_text = ""
    resume_file_name = None

    # Option 1: existing resume from DB
    if resume_id:
        try:
            resume_doc = await db.resumes.find_one({"_id": ObjectId(resume_id)})
        except Exception:
            resume_doc = None

        if resume_doc:
            r_text = resume_doc.get("extracted_text", "")
            resume_file_name = resume_doc.get("file_name")
            # If extracted_text is short, re-read from file
            if (not r_text or len(r_text) < 50) and resume_doc.get("file_path"):
                file_path = resume_doc["file_path"]
                if os.path.exists(file_path):
                    with open(file_path, "rb") as f:
                        r_text = extract_text_from_bytes(f.read(), file_path)

    # Option 2: uploaded file
    if not r_text and resume and resume.filename:
        file_bytes = await resume.read()
        r_text = extract_text_from_bytes(file_bytes, resume.filename)
        resume_file_name = resume.filename

    # Option 3: pasted text
    if not r_text and resume_text:
        r_text = resume_text.strip()

    if not r_text:
        raise HTTPException(
            status_code=400,
            detail="Please select a resume, upload one, or paste resume text.",
        )

    # ---- Create session & persist -------------------------------------------
    session_id = str(uuid.uuid4())
    now = datetime.utcnow()

    interview_doc = {
        "session_id": session_id,
        "user_id": user_id,
        "candidate_name": candidate_name,
        "resume_text": r_text,
        "resume_file_name": resume_file_name,
        "resume_id": resume_id,
        "job_description": job_description,
        "status": "in_progress",
        "mode": "voice",
        "created_at": now,
        "completed_at": None,
        "transcript": None,
        "report": None,
    }

    await db[COLLECTION].insert_one(interview_doc)

    assistant_config = build_vapi_assistant_config(candidate_name, r_text, job_description)

    return {
        "session_id": session_id,
        "candidate_name": candidate_name,
        "assistant_config": assistant_config,
        "vapi_public_key": settings.vapi_public_key,
    }


# ---------------------------------------------------------------------------
# Voice Interview - submit transcript & generate report
# ---------------------------------------------------------------------------


@router.post("/vapi/report")
async def vapi_report(body: VapiReportRequest, db=Depends(get_db)):
    """Receive full transcript from Vapi, generate report with Groq, save."""
    session_id = body.session_id
    transcript = body.transcript

    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required.")

    row = await db[COLLECTION].find_one({"session_id": session_id})
    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    resume_text = row["resume_text"]
    job_description = row["job_description"]
    candidate_name = row["candidate_name"]

    report_data = generate_voice_report(
        candidate_name, resume_text, job_description, transcript
    )

    now = datetime.utcnow()
    await db[COLLECTION].update_one(
        {"session_id": session_id},
        {
            "$set": {
                "transcript": transcript,
                "report": report_data,
                "status": "completed",
                "completed_at": now,
            }
        },
    )

    return {
        "report": report_data,
        "qa_pairs": report_data.get("qa_pairs", []),
        "completed_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------


@router.get("/report/{session_id}")
async def get_report(session_id: str, db=Depends(get_db)):
    """Return stored report for a session."""
    row = await db[COLLECTION].find_one({"session_id": session_id})

    if not row or not row.get("report"):
        raise HTTPException(status_code=404, detail="Report not found.")

    report_data = row["report"]
    return {
        "report": report_data,
        "candidate_name": row["candidate_name"],
        "qa_pairs": report_data.get("qa_pairs", []),
        "completed_at": row.get("completed_at").isoformat() if row.get("completed_at") else None,
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
    }


@router.get("/sessions/{user_id}")
async def list_sessions(user_id: str, db=Depends(get_db)):
    """List interview sessions for a specific user."""
    cursor = (
        db[COLLECTION]
        .find(
            {"user_id": user_id},
            {
                "_id": 0,
                "session_id": 1,
                "candidate_name": 1,
                "job_description": 1,
                "resume_file_name": 1,
                "status": 1,
                "mode": 1,
                "created_at": 1,
                "completed_at": 1,
            },
        )
        .sort("created_at", -1)
        .limit(50)
    )
    sessions = []
    async for doc in cursor:
        if doc.get("created_at"):
            doc["created_at"] = doc["created_at"].isoformat()
        if doc.get("completed_at"):
            doc["completed_at"] = doc["completed_at"].isoformat()
        sessions.append(doc)
    return sessions
