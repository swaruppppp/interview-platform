# Live Technical Interview & Secure Code Assessment Platform

Monorepo containing Sprint 1 (Isolated Docker Execution Engine + BullMQ Worker + Express/Socket.IO API) and Sprint 3 (AI Interviewer Co-Pilot + MinIO/S3 Session Snapshot Replay).

## Endpoints Included

- `POST /api/rooms` & `GET /api/rooms/:code` — Live collaborative interview rooms
- `POST /api/submissions` & `GET /api/submissions/:id` — Queued isolated Docker execution (C++20, Python 3.12, Node 22)
- `PATCH /api/rooms/:code/evaluation` — Save interviewer notes and 4-axis rubric scores
- `GET /api/rooms/:code/replay` — Fetch full chronological session replay from MinIO/S3
- `POST /api/copilot/blueprint` — JD-to-Assessment Blueprint generator (with human review gate)
- `POST /api/copilot/analyze` — Complexity estimator, failure root-cause explainer, and adaptive follow-up questions
- `POST /api/copilot/rooms/:code/evidence-summary` — Evidence-only rubric summary (strictly non-autonomous)
