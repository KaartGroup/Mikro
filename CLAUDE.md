# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mikro is an OSM (OpenStreetMap) micropayments platform by Kaart. It tracks user tasks (mapping/validation), manages payments, and handles training/checklists for mappers.

## Tech Stack

- **Backend**: Python 3, Flask, SQLAlchemy, PostgreSQL with PostGIS
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Auth0 (`frontend/mikro-next/`)
- **Authentication**: Auth0 (migrated from Kaart SSO)

## Development Commands

### Backend
```bash
cd backend
source venv/bin/activate          # Activate virtualenv
pip3 install -r requirements.txt  # Install dependencies
flask run -p 5004 --reload        # Run dev server on port 5004
```

### Frontend
```bash
cd frontend/mikro-next
npm install
npm run dev                       # Run on port 3000
```

For local dev, use `dev.localhost:3000` in browser to avoid CORS issues. Open Chrome in CORS-disabled mode:
```bash
open -n -a /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --args --user-data-dir="/tmp/chrome_dev_test" --disable-web-security
```

### Linting/Formatting
```bash
# Backend
black .
flake8

# Frontend
npm run prettier
```

### Tests
```bash
# Backend (from backend/)
python -m pytest tests/

# Frontend
npm test
```

## Architecture

### Backend Structure (`backend/`)
- `app.py` - Flask app initialization, route registration, JWT/SSO setup
- `api/views/` - API endpoints organized by domain:
  - `Login.py`, `Users.py`, `Projects.py`, `Tasks.py`, `Transactions.py`, `Training.py`, `Checklists.py`
- `api/database/core.py` - SQLAlchemy models (User, Project, Task, Checklist, Training, Payments, etc.)
- `api/database/common.py` - Base model mixins (CRUDMixin, SoftDelete)
- `api/static_variables.py` - Environment config (Postgres connection, etc.)
- `mikro.env` - Environment variables

### Frontend Structure (`frontend/mikro-next/src/`)
- `app/` - Next.js app routes and page components
- `components/` - shared UI and feature components
- `lib/` - Auth0 and API helpers
- `types/` - shared TypeScript types

### User Roles
Three roles with different access levels: `admin`, `validator`, `user`

### API Routes
Backend routes follow pattern `/<resource>/<path>` (production) or `/api/<resource>/<path>` (dev, commented out in app.py)

## Database

PostgreSQL with PostGIS extension. Key models:
- `User` - Mapper accounts with payment tracking, points, assigned projects
- `Project` - OSM tasking projects with payment rates
- `Task` - Individual mapping/validation tasks
- `Checklist`/`UserChecklist` - Task checklists for users
- `Training` - Training modules with questions/answers
- `Payments`/`PayRequests` - Payment tracking

Migrations handled via Flask-Migrate (Alembic).

## Port Conventions
- SSO: 5001
- Viewer: 5002
- Tabula Rasa: 5003
- Mikro: 5004
- Gem: 5000
- Frontend: 3000

## Deployment

Deployed to mikro.kaart.com via GitLab CI/CD to Kubernetes. See `deployment/kubernetes/` for configs.

## Auth0 Configuration (mikro-next)

### Environment Variables
Create `frontend/mikro-next/.env.local` with:
```
AUTH0_SECRET=<random-32-char-string>
AUTH0_DOMAIN=dev-p6r3cciondp4has2.us.auth0.com
AUTH0_ISSUER_BASE_URL=https://dev-p6r3cciondp4has2.us.auth0.com
AUTH0_CLIENT_ID=<your-client-id>
AUTH0_CLIENT_SECRET=<your-client-secret>
AUTH0_BASE_URL=http://localhost:3000
AUTH0_AUDIENCE=https://mikro/api/authorize
```

### Auth0 Dashboard Setup
1. **Application Type**: Regular Web Application
2. **Allowed Callback URLs**: `http://localhost:3000/auth/callback`
3. **Allowed Logout URLs**: `http://localhost:3000`
4. **API Authorization**: In Application → APIs tab, ensure **User Access** is AUTHORIZED for the Mikro API (not just Client Access)

### SDK v4 + Next.js 16 Notes
- Auth0 SDK v4 uses `/auth/login`, `/auth/logout`, `/auth/callback` routes (not `/api/auth/`)
- Auth0 routes are handled by `auth0.middleware()` in `src/middleware.ts` (standard Next.js middleware)
- Auth0 client config is in `src/lib/auth0.ts`

### Troubleshooting
- **"Client not authorized to access resource server"**: Go to Application → APIs tab → Edit the API → Toggle **User Access** to AUTHORIZED
- **Callback URL mismatch**: Add `http://localhost:3000/auth/callback` to Allowed Callback URLs in Auth0 Application settings

## API Field Naming Conventions

**Important**: Backend expects camelCase field names in request payloads:

### Checklists API (`/checklist/`)
- `checklistName` (not `name`)
- `checklistDescription` (not `description`)
- `completionRate` (not `completion_rate`)
- `validationRate` (not `validation_rate`)
- `checklistDifficulty` (not `difficulty`) - for create
- `difficulty` - for update
- `checklistSelected` (not `checklist_id`) - for update/delete
- `checklistStatus` (not `active_status`) - for update
- `listItems` - array of `{number, action, link}`

### Checklists Response Keys
Backend returns these keys (update frontend types accordingly):
- `active_checklists`
- `inactive_checklists`
- `ready_for_confirmation` (not `completed_checklists`)
- `confirmed_and_completed` (not `confirmed_checklists`)
- `stale_started_checklists` (not `stale_checklists`)
- `pending_checklists`

### Training API (`/training/`)
- `update_training` - metadata-only updates (title, url, points, difficulty)
- `modify_training` - full update including questions
- Questions format returned: `{id, question, answers: [{id, answer, correct}]}`

## Recent Development Notes (Jan 2025)

### Fixes Applied

1. **Projects 500 Error** - Removed references to non-existent `project.source` column in `backend/api/views/Projects.py` (5 occurrences)

2. **Training Questions/Edit Crashes** - Updated `format_training()` in `Training.py` to return frontend-expected structure with `answers` array containing `{id, answer, correct}`

3. **Training Update 405 Error** - Added new `update_training` endpoint for metadata-only updates (separate from `modify_training` which rebuilds questions)

4. **Checklist Create TypeError** - Fixed frontend field names to match backend expectations (camelCase)

5. **Checklists Not Showing in Table** - Fixed frontend to use correct backend response keys (`ready_for_confirmation`, `confirmed_and_completed`, etc.)

6. **Checklist Update TypeError** - Fixed update payload field names (`checklistSelected`, `checklistName`, etc.)

7. **Checklist Activation Toggle** - Added active status toggle to Edit Checklist modal in admin checklists page

### Checklist Status Workflow
- New checklists are created with `active_status=False` (appear in Inactive tab)
- Admin must activate checklist via Edit modal toggle
- Active checklists can be assigned to users
- Assigned checklists appear in user's checklist tabs based on completion state
