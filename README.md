# CertiFlow — Skilling Certificate Issuance Platform

Workflow, atomic CSV import, audit records, verification, simulated WhatsApp delivery, Docker Compose and tests** are implemented as a solid baseline; some production hardening and UI flows are intentionally documented as limitations.

## Quick start (Docker required)
1. Clone/extract this project.
2. From this folder run: `docker compose up --build`
3. Open http://localhost:5173
4. API: http://localhost:4000; health: `/health`

Demo identities (demo-only, seeded; select a persona from the sign-in screen):
- Anika — centre — `anika`
- Dev — district officer — `dev`
- Meera — district officer — `meera`
- Kabir — district officer — `kabir`
- Neha — quality — `neha`
- Farah — state — `farah`

The app uses role-based demo sign-in, CSV batch upload, workflow action endpoints, certificate verification, and a simulator queue.

## CSV
Header columns: `name,email,course,score`
Rows must contain all fields, email must be unique within the file and score must be 0–100. Import is all-or-nothing. A sample is in `sample-candidates.csv`.

## Workflow (documented choices)
- Centre submits a batch -> district review.
- Two distinct district officers must approve; district votes are guarded transactionally. One rejection/return can send the batch back.
- Batch sizes >= 50 require Quality review before state review.
- State office final approval triggers issuance (one certificate per candidate) and delivery jobs.
- State cancellation revokes the certificate and records the audit event together; verification returns revoked.
- Return to centre clears district approvals for the new submission (explicit policy: all approvals reset, old decision records remain in immutable audit history).
- Public verification uses a random token and returns only the name, course, status and issue date; it never exposes email, phone or score.
- District votes lock the batch row while counting approvals, so concurrent votes cannot lose the second approval.
- State dashboard flags approval-stage batches unchanged for 48 hours; demo updates use 10-second polling.
- Delivery rows are committed with certificate issuance and act as a local outbox; the worker enqueues them into BullMQ, retries transient failures and records terminal failures. A real provider, phone field and generated PDF are not included.
- Public verification exposes certificate status and reference only, not candidate identity or course.
- Certificate preview can be printed/saved as PDF and includes the public verification token.

## Tech
React/Vite, Express/TypeScript, Prisma/Postgres, Redis/BullMQ. API emits audit entries; queue processing is asynchronous. Prisma schema is migrated on startup for local demo (production should run migrations separately).

## Commands
`docker compose up --build`  
`docker compose down`  
`docker compose down -v` (destroys local DB/Redis volumes)  
`docker compose exec api npm test`

## API overview
- `POST /api/login` `{username}` -> demo JWT
- `GET /api/me`
- `POST /api/batches` (centre) JSON `{name,candidates:[{name,email,course,score}]}`
- `POST /api/batches/import` (centre) multipart CSV
- `POST /api/batches/:id/submit`
- `GET /api/batches`
- `GET /api/batches/stalled` (state office; batches unchanged for 48 hours)
- `GET /api/certificates` (authenticated)
- `POST /api/batches/:id/district-vote` `{decision:"approve"|"reject"|"return",reason?}`
- `POST /api/batches/:id/quality` `{decision:"approve"|"return",reason?}`
- `POST /api/batches/:id/state` `{decision:"approve"|"reject"|"return",reason?}`
- `POST /api/certificates/:id/cancel` (state)
- `GET /api/certificates/:token/verify` (public)
- `GET /api/audit/:batchId` (authenticated)

## Deployment plan
See [DEPLOYMENT.md](DEPLOYMENT.md). Requirements and deliberate trade-offs are in [REQUIREMENTS.md](REQUIREMENTS.md).

## AI usage
AI assistance was used to scaffold and review code and documentation. The developer should review, test, and be able to explain every submitted line. Do not claim AI output was independently verified unless you personally ran the tests and inspected the result.
