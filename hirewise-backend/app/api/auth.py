from fastapi import APIRouter, Depends, HTTPException, status
from app.database import get_db
from app.models.models import UserCreate, UserInDB
from app.utils.auth import get_password_hash, verify_password
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from bson import ObjectId

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# Pydantic models
class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: Optional[str] = None
    education: Optional[list] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class AuthResponse(BaseModel):
    user: dict

@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest, db = Depends(get_db)):
    """Register a new user"""
    # Check if user exists
    existing_user = await db.users.find_one({"email": request.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create new user document
    user_data = {
        "email": request.email,
        "full_name": request.full_name,
        "phone": request.phone,
        "password_hash": get_password_hash(request.password),
        "created_at": datetime.utcnow(),
        "last_login": None
    }
    
    # Insert user
    result = await db.users.insert_one(user_data)
    user_id = str(result.inserted_id)
    
    # Add education if provided
    if request.education:
        education_docs = []
        for edu in request.education:
            education_doc = {
                "user_id": user_id,
                "degree": edu.get('degree'),
                "institution": edu.get('institution'),
                "year": edu.get('year'),
                "field_of_study": edu.get('field')
            }
            education_docs.append(education_doc)
        if education_docs:
            await db.education.insert_many(education_docs)
    
    return {
        "user": {
            "userId": user_id,
            "email": request.email,
            "fullName": request.full_name,
            "phone": request.phone
        }
    }

@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, db = Depends(get_db)):
    """Login user"""
    user = await db.users.find_one({"email": request.email})
    
    if not user or not verify_password(request.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Update last login
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login": datetime.utcnow()}}
    )
    
    return {
        "user": {
            "userId": str(user["_id"]),
            "email": user["email"],
            "fullName": user["full_name"],
            "phone": user.get("phone")
        }
    }

@router.get("/profile/{user_id}")
async def get_profile(user_id: str, db = Depends(get_db)):
    """Get user profile with education"""
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get education records
    education = []
    async for edu in db.education.find({"user_id": user_id}):
        education.append({
            "educationId": str(edu["_id"]),
            "degree": edu.get("degree"),
            "institution": edu.get("institution"),
            "year": edu.get("year"),
            "field": edu.get("field_of_study")
        })
    
    return {
        "success": True,
        "data": {
            "userId": str(user["_id"]),
            "email": user["email"],
            "fullName": user["full_name"],
            "phone": user.get("phone"),
            "profilePicture": user.get("profile_picture"),
            "education": education,
            "createdAt": user["created_at"].isoformat(),
            "lastLogin": user.get("last_login").isoformat() if user.get("last_login") else None
        }
    }

class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    education: Optional[list] = None
    profile_picture: Optional[str] = None  # Base64 encoded image

@router.put("/profile/{user_id}")
async def update_profile(user_id: str, request: UpdateProfileRequest, db = Depends(get_db)):
    """Update user profile"""
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update user fields
    update_fields = {}
    if request.full_name is not None:
        update_fields["full_name"] = request.full_name
    if request.phone is not None:
        update_fields["phone"] = request.phone
    if request.profile_picture is not None:
        update_fields["profile_picture"] = request.profile_picture
    
    if update_fields:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": update_fields}
        )
    
    # Update education if provided
    if request.education is not None:
        # Delete existing education
        await db.education.delete_many({"user_id": user_id})
        
        # Insert new education records
        if request.education:
            education_docs = []
            for edu in request.education:
                education_doc = {
                    "user_id": user_id,
                    "degree": edu.get('degree'),
                    "institution": edu.get('institution'),
                    "year": edu.get('year'),
                    "field_of_study": edu.get('field')
                }
                education_docs.append(education_doc)
            await db.education.insert_many(education_docs)
    
    # Fetch updated profile
    updated_user = await db.users.find_one({"_id": ObjectId(user_id)})
    
    # Get updated education
    education = []
    async for edu in db.education.find({"user_id": user_id}):
        education.append({
            "educationId": str(edu["_id"]),
            "degree": edu.get("degree"),
            "institution": edu.get("institution"),
            "year": edu.get("year"),
            "field": edu.get("field_of_study")
        })
    
    return {
        "success": True,
        "data": {
            "userId": str(updated_user["_id"]),
            "email": updated_user["email"],
            "fullName": updated_user["full_name"],
            "phone": updated_user.get("phone"),
            "profilePicture": updated_user.get("profile_picture"),
            "education": education
        },
        "message": "Profile updated successfully"
    }
