# HireWise

AI-powered interview preparation platform with ATS resume checking, JD matching, and mock interviews.

## Tech Stack

**Frontend:** HTML, CSS, JavaScript, Tailwind CSS  
**Backend:** FastAPI, MongoDB, Google Gemini AI, spaCy

## Project Structure

```
HireWise/
├── hirewise-frontend/      # Static frontend
│   ├── index.html          # Landing page
│   ├── auth.html           # Authentication
│   ├── dashboard.html      # Main dashboard
│   ├── css/                # Stylesheets
│   ├── js/                 # JavaScript modules
│   ├── components/         # HTML components
│   └── data/               # Config & mock data
│
└── hirewise-backend/       # FastAPI backend
    ├── app/
    │   ├── main.py         # Application entry
    │   ├── config.py       # Configuration
    │   ├── database.py     # MongoDB setup
    │   ├── api/            # Route handlers
    │   ├── models/         # Pydantic models
    │   ├── services/       # Business logic
    │   └── utils/          # Utilities
    ├── uploads/            # PDF storage
    ├── reports/            # Generated reports
    └── requirements.txt    # Dependencies
```

## Quick Start

### Backend

```bash
cd hirewise-backend
pip install -r requirements.txt
python -m spacy download en_core_web_sm
cp .env.example .env    # Configure your environment
start_server.bat        # Windows
```

### Frontend

```bash
cd hirewise-frontend
python -m http.server 8000
```

**Backend:** http://localhost:8001  
**Frontend:** http://localhost:8000  
**API Docs:** http://localhost:8001/docs

## Environment Variables

```env
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=hirewise
GEMINI_API_KEY=your-api-key
FRONTEND_URL=http://localhost:8000
```

## License

MIT License
