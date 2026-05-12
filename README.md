# NEW MIKRO

## Overview:

# Mikro

Mikro is an OSM micropayments platform by Kaart.

Current implementation:
- Backend: Flask app in `backend/`
- Frontend: Next.js app in `frontend/mikro-next/`

## Development

### Backend
```bash
cd backend
source venv/bin/activate
pip3 install -r requirements.txt
flask run -p 5004 --reload
```

### Frontend
```bash
cd frontend/mikro-next
npm install
npm run dev
```

## Linting / Formatting
```bash
# Backend
black .
flake8

# Frontend
npm run prettier
```

## Tests
```bash
# Backend (from backend/)
python -m pytest tests/

# Frontend
npm test
```



