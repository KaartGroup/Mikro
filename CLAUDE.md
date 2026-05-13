# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Mikro is an OSM micropayments platform by Kaart. It manages mapper tasks, payments, checklists, training, reports, and team workflow.

## Tech Stack

- **Backend**: Python 3, Flask, SQLAlchemy, PostgreSQL with PostGIS
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Auth0 (`frontend/mikro-next/`)
- **Deployment**: GitLab CI/CD deploying to Kubernetes

## Repository Layout

### Backend (`backend/`)
- `app.py` - Flask application factory, route registration, CORS, auth hook, health checks
- `api/config.py` - environment-based config loader
- `api/static_variables.py` - shared environment constants
- `api/auth/` - request authentication and authorization helpers
- `api/views/` - API view classes for all domain routes
- `api/database/` - SQLAlchemy ORM setup and models
- `migrations/` - Alembic/Flask-Migrate migration scripts
- `tests/` - backend test suite

### Frontend (`frontend/mikro-next/`)
- `src/app/` - Next.js app routes and layout
- `src/components/` - UI components and feature widgets
- `src/lib/` - Auth0 client helpers and API utilities
- `src/types/` - shared TypeScript interfaces
- `package.json` - Next.js scripts and dependencies

## Development

### Backend
```bash
cd backend
source venv/bin/activate
pip3 install -r requirements.txt
flask run -p 5004 --reload
```

In a separate terminal, start the worker (handles background jobs like element analysis, transcription, task syncs):
```bash
cd backend
source venv/bin/activate
python -m api.worker
```

### Frontend
```bash
cd frontend/mikro-next
npm install
npm run dev
```

### Format & lint
```bash
# Backend
black .
flake8

# Frontend
npm run prettier
```

### Tests
```bash
# Backend
python -m pytest tests/

# Frontend
npm test
```

## Important Notes

- The active frontend is `frontend/mikro-next/`. That is the current implementation.
- Backend API routes are exposed under `/api/<resource>/<path>`.
- Auth0 integration is handled in the Next.js app, with client helpers under `frontend/mikro-next/src/lib/`.
- Local frontend default port is 3000; backend default dev port is 5004.
- The backend supports database migrations via Flask-Migrate and Alembic in `backend/migrations/`.

## Relevant Files

- `backend/app.py`
- `backend/api/views/` (Login, User, Project, Transaction, Task, Training, Checklist, TimeTracking, Team, Reports, Region, Webhook, Punk, WeeklyReport, Friend, CommunityData, ChannelMonitor, Transcription)
- `backend/api/database/core.py`
- `frontend/mikro-next/package.json`
- `frontend/mikro-next/src/app/`
- `frontend/mikro-next/src/lib/auth0.ts`

## Project Scope

- User / team management
- Task assignment and validation
- Payments and transactions
- Training and checklist workflows
- Time tracking and reporting
- OSM authentication and webhook support
- Transcription support via Whisper integration
