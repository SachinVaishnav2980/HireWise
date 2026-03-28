"""
Interview Voice Service – Vapi voice interview helpers.

Groq is used for report generation after the voice interview.
"""

import io
import json
from typing import Optional

import PyPDF2
from groq import Groq

from app.config import settings

# ---------------------------------------------------------------------------
# Groq client (initialised once at module level)
# ---------------------------------------------------------------------------

_groq_client: Optional[Groq] = None


def _get_groq_client() -> Groq:
    global _groq_client
    if _groq_client is None:
        _groq_client = Groq(api_key=settings.groq_api_key)
    return _groq_client


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def extract_text_from_bytes(file_bytes: bytes, filename: str) -> str:
    """Extract text from uploaded file bytes (PDF or plain text)."""
    if filename.lower().endswith(".pdf"):
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    return file_bytes.decode("utf-8", errors="ignore")


def groq_chat(
    messages: list,
    model: str = "llama-3.3-70b-versatile",
    max_tokens: int = 2048,
) -> str:
    client = _get_groq_client()
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.7,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content.strip()


def parse_json(raw: str):
    """Strip optional markdown fences and parse JSON."""
    cleaned = raw.strip()
    for fence in ["```json", "```"]:
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return json.loads(cleaned.strip())


def generate_voice_report(
    candidate_name: str,
    resume_text: str,
    job_description: str,
    transcript: list,
) -> dict:
    """Analyse a voice-interview transcript and return a structured report."""
    transcript_text = "\n".join(
        f"{msg['role'].upper()}: {msg.get('text', msg.get('content', ''))}"
        for msg in transcript
    )

    system_prompt = (
        "You are a senior hiring manager reviewing a complete voice interview transcript. "
        "Analyze the candidate's answers in the context of the resume and job description. "
        "Return ONLY a valid JSON object with keys: "
        "\"overall_score\" (float 1-10, 1 decimal), "
        "\"overall_verdict\" (Strong Hire | Hire | Maybe | No Hire), "
        "\"summary\" (3-4 sentence overall assessment), "
        "\"top_strengths\" (list of exactly 3 strings), "
        "\"key_gaps\" (list of exactly 3 strings), "
        "\"recommendation\" (1-2 sentences for the hiring team), "
        "\"qa_pairs\" (array - one object per candidate answer, each with: "
        "\"question\" (string), \"answer\" (string), "
        "\"score\" (int 1-10), "
        "\"verdict\" (Excellent | Good | Average | Needs Improvement), "
        "\"strengths\" (list), \"improvements\" (list), "
        "\"ideal_answer_summary\" (string)). "
        "Pure JSON only - no markdown fences."
    )

    user_prompt = (
        f"Candidate: {candidate_name}\n\n"
        f"Job Description:\n{job_description[:800]}\n\n"
        f"Resume:\n{resume_text[:2000]}\n\n"
        f"Full Interview Transcript:\n{transcript_text}"
    )

    raw = groq_chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=4096,
    )
    return parse_json(raw)


def build_vapi_assistant_config(
    candidate_name: str, resume_text: str, job_description: str
) -> dict:
    """Build the Vapi assistant configuration for a voice interview."""
    system_prompt = f"""You are Laxon, a professional AI interviewer. Conduct a real, adaptive voice interview.

CANDIDATE NAME: {candidate_name}

RESUME:
{resume_text[:3000]}

JOB DESCRIPTION:
{job_description[:1500]}

INTERVIEW FLOW (follow this order):
1. GREETING: Greet {candidate_name} by name. Introduce yourself as "Laxon, your AI interviewer". Mention this is a voice interview for the role described in the JD.
2. INTRODUCTION: Ask {candidate_name} to briefly introduce themselves and walk you through their background.
3. RESUME DEEP-DIVE: Ask 2-3 targeted questions about specific experiences, projects, or skills mentioned in their resume. Reference actual details from the resume.
4. JD-BASED QUESTIONS: Ask 3-4 technical or role-specific questions based on the key requirements in the JD.
5. BEHAVIOURAL: Ask 1-2 behavioural questions using STAR format (e.g., "Tell me about a time when...").
6. WRAP-UP: After sufficient coverage (typically 7-10 questions total), say: "That wraps up our interview today, {candidate_name}. Thank you for your time - we will review everything and be in touch. Goodbye for now."

PERFORMANCE ADAPTATION:
- If answers are strong and detailed, ask a probing follow-up before moving on.
- If answers are brief or weak, acknowledge politely and move to the next topic.
- Adjust total length: strong candidates get deeper questions; weaker ones get the core set only.

STRICT RULES:
- Ask ONE question at a time. Never stack multiple questions.
- Keep your own turns very short (1-4 sentences max).
- Brief transitions only: "Got it, thank you." / "Interesting, let us continue." / "Great, moving on."
- Do NOT reveal scores, hints, or correct answers during the interview.
- Do NOT say you are a large language model or AI system.
- Speak in a warm, professional, natural tone - like a real human recruiter.
"""

    return {
        "name": "Laxon - AI Interviewer",
        "firstMessage": (
            f"Hello {candidate_name}! I am Laxon, your AI interviewer today. "
            "We will have a natural conversation - I will ask you questions about your background "
            "and the role, and you just speak your answers naturally. "
            "Ready to get started?"
        ),
        "model": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "messages": [{"role": "system", "content": system_prompt}],
            "temperature": 0.7,
            "maxTokens": 512,
        },
        "voice": {
            "provider": "openai",
            "voiceId": "alloy",
        },
        "transcriber": {
            "provider": "deepgram",
            "model": "nova-2",
            "language": "en-US",
        },
        "endCallMessage": (
            f"Thank you {candidate_name}, your interview is now complete. "
            "We will review your responses and get back to you. Goodbye!"
        ),
        "endCallPhrases": [
            "goodbye for now",
            "we will be in touch",
            "interview is complete",
            "that wraps up",
        ],
        "silenceTimeoutSeconds": 30,
        "maxDurationSeconds": 3600,
        "recordingEnabled": False,
    }
