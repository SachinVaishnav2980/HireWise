from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId

# Custom ObjectId type for Pydantic
class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, field_schema):
        field_schema.update(type="string")

# User Model
class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None

class UserCreate(UserBase):
    password: str
    education: Optional[List[dict]] = None

class UserInDB(UserBase):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    password_hash: str
    profile_picture: Optional[str] = None  # Base64 encoded image or URL
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = None
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# Education Model
class Education(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    degree: str
    institution: str
    year: str
    field_of_study: Optional[str] = None
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# Interview Model
class Interview(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    role: str
    status: str  # in-progress, completed
    score: Optional[float] = None
    questions: List[dict] = []
    answers: Optional[List[dict]] = None
    feedback: Optional[List[dict]] = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# Resume Model
class Resume(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    file_name: str
    file_path: str
    file_type: str
    extracted_text: Optional[str] = None
    ats_score: Optional[float] = None
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# ATS Result Model
class ATSResult(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    resume_id: Optional[str] = None
    overall_score: float
    formatting_score: float
    keywords_score: float
    readability_score: float
    structure_score: float
    experience_score: Optional[float] = None
    ai_score: Optional[float] = None
    component_scores: Optional[dict] = None
    component_confidence: Optional[dict] = None
    suggestions: List[str]
    warnings: Optional[List[str]] = None
    ai_analysis: Optional[dict] = None
    evaluation_metadata: Optional[dict] = None
    report_path: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# JD Match Model
class JDMatch(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    resume_id: Optional[str] = None
    job_description: str
    match_score: float
    technical_skills: float
    experience_score: float
    education_score: float
    keywords_score: float
    matched_skills: List[str]
    missing_skills: List[str]
    recommendations: List[str]
    ai_analysis: Optional[dict] = None
    report_path: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# Testimonial Model
class Testimonial(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    name: str
    title: str
    text: str
    rating: int
    interview_id: Optional[str] = None
    approved: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}

# Calendar Activity Model
class CalendarActivity(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    user_id: str
    activity_type: str  # interview, ats_check, jd_match, practice
    title: str
    description: Optional[str] = None
    date: datetime
    score: Optional[float] = None
    status: str  # scheduled, completed, cancelled
    reference_id: Optional[str] = None  # Reference to interview_id, ats_id, etc.
    metadata: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}
