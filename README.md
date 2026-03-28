# HireWise

AI-powered interview prep platform with ATS resume checks, JD matching, and mock interview workflows.

## Stack

- Frontend: HTML, CSS, JavaScript (Tailwind)
- Backend: FastAPI + MongoDB
- AI: Gemini/Groq integrations

## Run locally

### 1) Backend

```bash
cd hirewise-backend
pip install -r requirements.txt
python -m spacy download en_core_web_sm
copy .env.example .env
start_server.bat
```

### 2) Frontend

```bash
cd hirewise-frontend
python -m http.server 8000
```

- Frontend: http://localhost:8000
- Backend: http://localhost:8001
- API docs: http://localhost:8001/docs

## Environment (backend)

Set values in `hirewise-backend/.env`:

```env
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=hirewise
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
VAPI_PUBLIC_KEY=your_vapi_public_key
FRONTEND_URL=http://localhost:8000
```

## Repo hygiene

- Generated files in `hirewise-backend/uploads/` and `hirewise-backend/reports/` are ignored (except `.gitkeep`)
- Database dumps and BSON snapshots are ignored
- Do not commit real API keys or user data

## License

MIT
