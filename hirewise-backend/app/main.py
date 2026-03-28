from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import connect_to_mongo, close_mongo_connection
from app.config import settings
from app.api import auth, ats, jd_matcher, feedback, calendar, interview, landing, jobs
import os

# Ensure directories exist
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.reports_dir, exist_ok=True)

# Create FastAPI app
app = FastAPI(
    title="HireWise API",
    description="AI-Powered Interview Practice Platform Backend",
    version="1.0.0"
)

# CORS middleware - MUST be before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup and shutdown events
@app.on_event("startup")
async def startup_event():
    await connect_to_mongo()
    print("Application started successfully")

@app.on_event("shutdown")
async def shutdown_event():
    await close_mongo_connection()
    print("Application shutdown")

# Include routers
app.include_router(auth.router)
app.include_router(ats.router)
app.include_router(jd_matcher.router)
app.include_router(feedback.router)
app.include_router(calendar.router)
app.include_router(interview.router)
app.include_router(landing.router)
app.include_router(jobs.router)

@app.get("/")
def read_root():
    return {
        "message": "HireWise API",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
