from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from app.database import get_db
from app.models.models import Resume, ATSResult
from app.services.ats_service import ATSScorer
from app.services.report_service import ReportGenerator
from app.services.resume_extraction_service import ResumeExtractionService
from pydantic import BaseModel
from typing import Optional
import os
import tempfile
from datetime import datetime
from app.config import settings
from bson import ObjectId
from bson.binary import Binary
from fastapi.responses import Response

router = APIRouter(prefix="/api/ats", tags=["ATS Checker"])

_APP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_BACKEND_ROOT = os.path.abspath(os.path.join(_APP_ROOT, ".."))
_PROJECT_ROOT = os.path.abspath(os.path.join(_BACKEND_ROOT, ".."))


def _sanitize_filename(filename: str) -> str:
    """Return a safe filename for Content-Disposition headers."""
    if not filename:
        return "resume.pdf"
    return os.path.basename(filename).replace('"', "")


def _candidate_resume_paths(resume: dict):
    """Build possible on-disk locations for legacy records across different working directories."""
    candidates = []

    file_path = resume.get("file_path")
    file_name = _sanitize_filename(resume.get("file_name", ""))

    if file_path:
        normalized = os.path.normpath(file_path)
        candidates.append(normalized)

        if not os.path.isabs(normalized):
            candidates.extend(
                [
                    os.path.abspath(os.path.join(os.getcwd(), normalized)),
                    os.path.abspath(os.path.join(_BACKEND_ROOT, normalized)),
                    os.path.abspath(os.path.join(_PROJECT_ROOT, normalized)),
                ]
            )

    if file_name:
        upload_dir_norm = os.path.normpath(settings.upload_dir)
        candidates.extend(
            [
                os.path.abspath(os.path.join(settings.upload_dir, file_name)),
                os.path.abspath(os.path.join(os.getcwd(), settings.upload_dir, file_name)),
                os.path.abspath(os.path.join(_BACKEND_ROOT, upload_dir_norm, file_name)),
                os.path.abspath(os.path.join(_PROJECT_ROOT, upload_dir_norm, file_name)),
                os.path.abspath(os.path.join(_BACKEND_ROOT, "uploads", file_name)),
                os.path.abspath(os.path.join(_PROJECT_ROOT, "uploads", file_name)),
            ]
        )

    # De-duplicate while preserving order
    deduped = []
    seen = set()
    for p in candidates:
        key = os.path.normcase(os.path.normpath(p))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(p)

    return deduped


async def _load_resume_file_bytes(resume: dict, db):
    """Load resume bytes from DB first; fall back to file system and backfill DB for permanence."""
    file_data = resume.get("file_data")
    if file_data is not None:
        try:
            db_bytes = bytes(file_data)
            if len(db_bytes) > 0:
                return db_bytes, "database"
        except Exception as db_bytes_error:
            print(f"Warning: failed to parse file_data for resume {resume.get('_id')}: {db_bytes_error}")

    for candidate_path in _candidate_resume_paths(resume):
        if not os.path.exists(candidate_path):
            continue

        with open(candidate_path, "rb") as f:
            data = f.read()

        if not data:
            continue

        # Backfill DB so future view/download does not depend on local disk path
        try:
            await db.resumes.update_one(
                {"_id": resume["_id"]},
                {
                    "$set": {
                        "file_data": Binary(data),
                        "file_size": len(data),
                        "storage_source": "database",
                        "file_path": candidate_path,
                        "migrated_at": datetime.utcnow(),
                    }
                },
            )
        except Exception as migrate_error:
            print(f"Warning: failed to backfill file_data for resume {resume.get('_id')}: {migrate_error}")

        return data, "filesystem"

    return None, None


async def _load_resume_content_for_response(resume: dict, db, for_download: bool = False):
    """Return response-ready bytes/content metadata with graceful DB fallbacks."""
    file_bytes, source = await _load_resume_file_bytes(resume, db)
    if file_bytes:
        return {
            "content": file_bytes,
            "source": source,
            "media_type": resume.get("file_type") or "application/pdf",
            "filename": _sanitize_filename(resume.get("file_name", "resume.pdf")),
        }

    # Final DB-only fallback: extracted text can still be previewed/downloaded
    extracted_text = (resume.get("extracted_text") or "").strip()
    if extracted_text:
        text_filename = _sanitize_filename(resume.get("file_name", "resume"))
        if text_filename.lower().endswith(".pdf"):
            text_filename = text_filename[:-4] + ".txt"
        elif "." not in text_filename:
            text_filename = text_filename + ".txt"

        notice = (
            "[Recovered from database text because original file bytes were unavailable]\n\n"
            if for_download
            else ""
        )
        payload = (notice + extracted_text).encode("utf-8")
        return {
            "content": payload,
            "source": "database_extracted_text",
            "media_type": "text/plain; charset=utf-8",
            "filename": text_filename,
        }

    return None

class ATSResponse(BaseModel):
    success: bool
    data: dict
    message: str

@router.post("/analyze", response_model=ATSResponse)
async def analyze_ats(
    file: UploadFile = File(...),
    user_id: Optional[str] = Form(None),
    job_description: Optional[str] = Form(None),
    db = Depends(get_db)
):
    """Analyze resume for ATS compatibility"""
    
    print(f"=== ATS Analysis Started ===")
    print(f"File: {file.filename}")
    print(f"Content Type: {file.content_type}")
    print(f"User ID: {user_id}")
    
    # Validate file type
    if not file.filename.endswith(('.pdf', '.PDF')):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    # Read uploaded file bytes once so we can save both to disk and DB
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Save uploaded file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"resume_{timestamp}_{file.filename}"
    filepath = os.path.abspath(os.path.join(settings.upload_dir, filename))
    
    print(f"Saving file to: {filepath}")
    
    try:
        with open(filepath, "wb") as buffer:
            buffer.write(file_bytes)
        print(f"File saved successfully")
    except Exception as e:
        print(f"Error saving file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    
    try:
        # Extract text from PDF with confidence scoring
        print("Extracting text from PDF...")
        extraction_service = ResumeExtractionService()
        extraction_result = extraction_service.extract_with_confidence(filepath)
        resume_text = extraction_result.get("text", "")
        extraction_confidence = extraction_result.get("confidence", "low")
        extraction_warnings = extraction_result.get("warnings", [])
        extraction_metrics = extraction_result.get("metrics", {})

        print(f"Extracted {len(resume_text)} characters")
        print(f"Extraction confidence: {extraction_confidence}")
        
        if not resume_text or len(resume_text) < 50:
            raise HTTPException(status_code=400, detail="Could not extract text from PDF. The file may be corrupted or scanned image.")
        
        # Calculate ATS score (JD-aware)
        print("Calculating ATS score...")
        ats_scorer = ATSScorer()
        result = ats_scorer.calculate_ats_score(
            resume_text=resume_text,
            jd_text=job_description or "",
            extraction_confidence=extraction_confidence,
            extraction_metrics=extraction_metrics,
        )

        if result.get("final_score") is not None:
            print(f"ATS Score calculated: {result.get('overall_score')}")
        else:
            print("ATS score skipped due to low extraction confidence")
        
        # Save to database if user_id provided
        if user_id:
            print(f"Saving to database for user: {user_id}")
            # Save resume record
            resume_doc = {
                "user_id": user_id,
                "file_name": file.filename,
                "file_path": filepath,
                "file_type": "application/pdf",
                "file_size": len(file_bytes),
                "file_data": Binary(file_bytes),
                "storage_source": "database",
                "extracted_text": resume_text[:5000],  # Store first 5000 chars
                "ats_score": result.get('overall_score'),
                "extraction_confidence": extraction_confidence,
                "extraction_metrics": extraction_metrics,
                "uploaded_at": datetime.utcnow()
            }
            resume_result = await db.resumes.insert_one(resume_doc)
            resume_id = str(resume_result.inserted_id)
            print(f"Resume saved with ID: {resume_id}")
            
            # Save ATS result + evaluation metadata
            ats_doc = {
                "user_id": user_id,
                "resume_id": resume_id,
                "overall_score": result.get('overall_score'),
                "formatting_score": result.get('formatting_score', 0),
                "keywords_score": result.get('keywords_score', 0),
                "readability_score": result.get('readability_score', 0),
                "structure_score": result.get('structure_score', 0),
                "experience_score": result.get('experience_score', 0),
                "ai_score": result.get('ai_score', 0),
                "component_scores": result.get('component_scores', {}),
                "component_confidence": result.get('component_confidence', {}),
                "suggestions": result.get('suggestions', []),
                "warnings": result.get('warnings', []),
                "ai_analysis": result.get('ai_analysis'),
                "evaluation_metadata": {
                    **(result.get('evaluation_metadata', {}) or {}),
                    "job_description_present": bool(job_description),
                    "candidate_outcome_label": None,
                },
                "created_at": datetime.utcnow()
            }
            ats_insert = await db.ats_results.insert_one(ats_doc)
            ats_id = str(ats_insert.inserted_id)
            print(f"ATS result saved with ID: {ats_id}")

            # Generate report only when score is available
            if result.get('overall_score') is not None:
                print("Generating report...")
                report_gen = ReportGenerator()
                user = await db.users.find_one({"_id": ObjectId(user_id)})
                user_name = user['full_name'] if user else "User"
                report_path = report_gen.generate_ats_report(result, user_name)
                print(f"Report generated: {report_path}")

                # Update with report path
                await db.ats_results.update_one(
                    {"_id": ObjectId(ats_id)},
                    {"$set": {"report_path": report_path}}
                )
                result['reportPath'] = report_path

            result['atsId'] = ats_id
        
        # Format response
        final_score = result.get('final_score')
        warnings = (result.get('warnings') or []) + extraction_warnings

        response_data = {
            'final_score': final_score,
            'confidence': result.get('confidence', extraction_confidence),
            'component_scores': result.get('component_scores', {}),
            'component_confidence': result.get('component_confidence', {}),
            'warnings': warnings,
            # Backward-compatible fields for current frontend
            'overallScore': final_score if final_score is not None else 0,
            'metrics': {
                'formatting': result.get('formatting_score', 0),
                'keywords': result.get('keywords_score', 0),
                'readability': result.get('readability_score', 0),
                'structure': result.get('structure_score', 0),
                'experience': result.get('experience_score', 0),
                'ai': result.get('ai_score', 0),
            },
            'suggestions': result.get('suggestions', []),
            'foundKeywords': result.get('found_keywords', []),
            'sectionsFound': result.get('sections_found', []),
            'jdSkills': result.get('jd_skills', {"required_skills": [], "preferred_skills": []}),
            'scoreAvailable': final_score is not None,
        }
        
        if user_id:
            response_data['atsId'] = result.get('atsId')
            response_data['reportPath'] = result.get('reportPath')
        
        print("=== ATS Analysis Completed Successfully ===")
        
        return {
            "success": True,
            "data": response_data,
            "message": "ATS analysis complete"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"=== ERROR in ATS Analysis ===")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download/{ats_id}")
async def download_ats_report(ats_id: str, db = Depends(get_db)):
    """Download ATS report"""
    try:
        ats_result = await db.ats_results.find_one({"_id": ObjectId(ats_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid ATS ID")
    
    if not ats_result or not ats_result.get('report_path'):
        raise HTTPException(status_code=404, detail="Report not found")
    
    from fastapi.responses import FileResponse
    return FileResponse(
        ats_result['report_path'],
        media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename=os.path.basename(ats_result['report_path'])
    )

@router.get("/resumes/{user_id}")
async def get_user_resumes(user_id: str, db = Depends(get_db)):
    """Get all resumes for a user"""
    try:
        resumes = []
        async for resume in db.resumes.find({"user_id": user_id}).sort("uploaded_at", -1):
            has_file_data = bool(resume.get("file_data"))
            has_file_path = bool(resume.get("file_path"))
            has_extracted_text = bool((resume.get("extracted_text") or "").strip())
            resumes.append({
                "resumeId": str(resume["_id"]),
                "fileName": resume["file_name"],
                "uploadedAt": resume["uploaded_at"].isoformat(),
                "atsScore": resume.get("ats_score"),
                "availableInDb": has_file_data,
                "hasFallbackText": has_extracted_text,
                "canPreview": has_file_data or has_file_path or has_extracted_text,
            })
        
        return {
            "success": True,
            "data": resumes,
            "message": f"Found {len(resumes)} resume(s)"
        }
    except Exception as e:
        print(f"Error fetching resumes: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/resumes/file/{resume_id}")
async def get_resume_file(
    resume_id: str,
    user_id: Optional[str] = Query(None),
    db = Depends(get_db)
):
    """Get resume file for download/preview"""
    try:
        resume = await db.resumes.find_one({"_id": ObjectId(resume_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid resume ID")
    
    if not resume:
        raise HTTPException(status_code=404, detail="Resume file not found")

    if user_id and resume.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="You are not authorized to access this resume")
    
    resume_content = await _load_resume_content_for_response(resume, db, for_download=False)
    if not resume_content:
        raise HTTPException(status_code=404, detail="Resume file content not found")

    return Response(
        content=resume_content["content"],
        media_type=resume_content["media_type"],
        headers={
            "Content-Disposition": f'inline; filename="{resume_content["filename"]}"',
            "X-Resume-Source": resume_content["source"],
            "Cache-Control": "no-store",
        },
    )

@router.get("/resumes/download/{resume_id}")
async def download_resume_file(
    resume_id: str,
    user_id: Optional[str] = Query(None),
    db = Depends(get_db)
):
    """Download resume file as attachment"""
    try:
        resume = await db.resumes.find_one({"_id": ObjectId(resume_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid resume ID")

    if not resume:
        raise HTTPException(status_code=404, detail="Resume file not found")

    if user_id and resume.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="You are not authorized to access this resume")

    resume_content = await _load_resume_content_for_response(resume, db, for_download=True)
    if not resume_content:
        raise HTTPException(status_code=404, detail="Resume file content not found")

    return Response(
        content=resume_content["content"],
        media_type=resume_content["media_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{resume_content["filename"]}"',
            "X-Resume-Source": resume_content["source"],
            "Cache-Control": "no-store",
        },
    )

@router.delete("/resumes/{resume_id}")
async def delete_resume(
    resume_id: str,
    user_id: Optional[str] = Query(None),
    db = Depends(get_db)
):
    """Delete a resume and its associated file"""
    try:
        resume = await db.resumes.find_one({"_id": ObjectId(resume_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid resume ID")
    
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    if user_id and resume.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="You are not authorized to delete this resume")
    
    # Delete physical file if exists
    if resume.get('file_path') and os.path.exists(resume['file_path']):
        try:
            os.remove(resume['file_path'])
        except Exception as e:
            print(f"Error deleting file: {e}")
    
    # Delete from database
    await db.resumes.delete_one({"_id": ObjectId(resume_id)})
    
    # Also delete associated ATS results
    await db.ats_results.delete_many({"resume_id": resume_id})
    
    # Delete associated JD matches
    await db.jd_matches.delete_many({"resume_id": resume_id})
    
    return {
        "success": True,
        "message": "Resume deleted successfully"
    }

@router.post("/analyze-stored", response_model=ATSResponse)
async def analyze_stored_resume(
    resume_id: str = Form(...),
    user_id: Optional[str] = Form(None),
    job_description: Optional[str] = Form(None),
    db = Depends(get_db)
):
    """Analyze a previously uploaded resume for ATS compatibility"""
    try:
        # Fetch resume from database
        resume = await db.resumes.find_one({"_id": ObjectId(resume_id)})
        if not resume:
            raise HTTPException(status_code=404, detail="Resume not found")
        
        # Use extracted text from database if available
        resume_text = resume.get('extracted_text')
        extraction_confidence = resume.get('extraction_confidence', 'medium')
        extraction_metrics = resume.get('extraction_metrics', {})
        
        # If not available or too short, re-extract from DB/file fallback
        if not resume_text or len(resume_text) < 50:
            file_bytes, _ = await _load_resume_file_bytes(resume, db)
            if not file_bytes:
                raise HTTPException(status_code=404, detail="Resume file content not found")

            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
                    temp_file.write(file_bytes)
                    temp_path = temp_file.name

                extraction_service = ResumeExtractionService()
                extraction_result = extraction_service.extract_with_confidence(temp_path)
            finally:
                if temp_path and os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception as temp_cleanup_error:
                        print(f"Warning: failed to cleanup temp resume file {temp_path}: {temp_cleanup_error}")
            resume_text = extraction_result.get("text", "")
            extraction_confidence = extraction_result.get("confidence", "low")
            extraction_metrics = extraction_result.get("metrics", {})
        
        # Calculate ATS score (JD-aware)
        ats_scorer = ATSScorer()
        result = ats_scorer.calculate_ats_score(
            resume_text=resume_text,
            jd_text=job_description or "",
            extraction_confidence=extraction_confidence,
            extraction_metrics=extraction_metrics,
        )
        
        # Save ATS result to database
        if user_id:
            ats_doc = {
                "user_id": user_id,
                "resume_id": resume_id,
                "overall_score": result.get('overall_score'),
                "formatting_score": result.get('formatting_score', 0),
                "keywords_score": result.get('keywords_score', 0),
                "readability_score": result.get('readability_score', 0),
                "structure_score": result.get('structure_score', 0),
                "experience_score": result.get('experience_score', 0),
                "ai_score": result.get('ai_score', 0),
                "component_scores": result.get('component_scores', {}),
                "component_confidence": result.get('component_confidence', {}),
                "warnings": result.get('warnings', []),
                "suggestions": result.get('suggestions', []),
                "ai_analysis": result.get('ai_analysis'),
                "evaluation_metadata": {
                    **(result.get('evaluation_metadata', {}) or {}),
                    "job_description_present": bool(job_description),
                    "candidate_outcome_label": None,
                },
                "created_at": datetime.utcnow()
            }
            ats_insert = await db.ats_results.insert_one(ats_doc)
            ats_id = str(ats_insert.inserted_id)
            
            # Generate report
            report_path = None
            if result.get('overall_score') is not None:
                report_gen = ReportGenerator()
                user = await db.users.find_one({"_id": ObjectId(user_id)})
                user_name = user['full_name'] if user else "User"
                report_path = report_gen.generate_ats_report(result, user_name)
                
                # Update with report path
                await db.ats_results.update_one(
                    {"_id": ObjectId(ats_id)},
                    {"$set": {"report_path": report_path}}
                )
                
                # Update resume ATS score
                await db.resumes.update_one(
                    {"_id": ObjectId(resume_id)},
                    {
                        "$set": {
                            "ats_score": result.get('overall_score'),
                            "extraction_confidence": extraction_confidence,
                            "extraction_metrics": extraction_metrics,
                        }
                    }
                )
            
            result['atsId'] = ats_id
            result['reportPath'] = report_path
        
        # Format response
        final_score = result.get('final_score')
        response_data = {
            'final_score': final_score,
            'confidence': result.get('confidence', extraction_confidence),
            'component_scores': result.get('component_scores', {}),
            'component_confidence': result.get('component_confidence', {}),
            'warnings': result.get('warnings', []),
            # Backward-compatible fields for current frontend
            'overallScore': final_score if final_score is not None else 0,
            'metrics': {
                'formatting': result.get('formatting_score', 0),
                'keywords': result.get('keywords_score', 0),
                'readability': result.get('readability_score', 0),
                'structure': result.get('structure_score', 0),
                'experience': result.get('experience_score', 0),
                'ai': result.get('ai_score', 0),
            },
            'suggestions': result.get('suggestions', []),
            'foundKeywords': result.get('found_keywords', []),
            'sectionsFound': result.get('sections_found', []),
            'jdSkills': result.get('jd_skills', {"required_skills": [], "preferred_skills": []}),
            'scoreAvailable': final_score is not None,
        }
        
        if user_id:
            response_data['atsId'] = result.get('atsId')
            response_data['reportPath'] = result.get('reportPath')
        
        return {
            "success": True,
            "data": response_data,
            "message": "ATS analysis complete"
        }
    except Exception as e:
        print(f"Error analyzing stored resume: {e}")
        raise HTTPException(status_code=500, detail=str(e))
