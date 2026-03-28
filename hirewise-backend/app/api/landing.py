from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from app.database import get_db

router = APIRouter(prefix="/api/public", tags=["Public Landing"])


@router.get("/metrics")
async def get_public_metrics(db=Depends(get_db)):
    """Public metrics for landing page (no auth required)."""
    total_users = await db.users.count_documents({})
    total_interviews = await db.user_interviews.count_documents({})
    total_completed = await db.user_interviews.count_documents({"status": "completed"})
    total_resumes = await db.resumes.count_documents({})
    total_ats_reports = await db.ats_results.count_documents({})

    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    active_users_30d = await db.users.count_documents({"last_login": {"$gte": thirty_days_ago}})

    completion_rate = round((total_completed / total_interviews) * 100) if total_interviews else 0

    return {
        "success": True,
        "data": {
            "total_users": total_users,
            "active_users_30d": active_users_30d,
            "total_interviews": total_interviews,
            "completed_interviews": total_completed,
            "completion_rate": completion_rate,
            "total_resumes": total_resumes,
            "total_ats_reports": total_ats_reports,
            "updated_at": datetime.utcnow().isoformat(),
        },
    }
