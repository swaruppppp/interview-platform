# CodeAssess — Live Technical Interview & Secure Code Execution Platform

A production-oriented technical assessment platform featuring **real-time collaborative coding**, **isolated Docker execution worker queues**, **S3-backed session replay**, and an **evidence-only AI Interviewer Co-Pilot** designed to assist human reviewers without making autonomous hiring decisions.

## System Architecture

```text
+---------------------------+          WebSocket (code, cursors, verdicts)          +-----------------------------+
|  React + Vite + Tailwind  | <---------------------------------------------------> |  Express + Socket.IO API    |
|  Monaco Editor + Drawer   | -------------------- REST /api/* -------------------> |  (Zero Untrusted Execution) |
+---------------------------+                                                       +------+-------+-------+------+
                                                                                           |       |       |
                                         +-------------------------------------------------+       |       +------------------+
                                         | Enqueue Job (BullMQ)                                    |                          |
                                         v                                                         v                          v
                              +--------------------+                                    +--------------------+     +--------------------+
                              |   Redis (BullMQ    |                                    |     MongoDB 7      |     |  SeaweedFS (S3)    |
                              |    + Pub/Sub)      |                                    | Rooms, Problems,   |     | Session Snapshots  |
                              +---------+----------+                                    | Rubrics, Verdicts  |     |  (Replay Engine)   |
                                        |                                               +--------------------+     +--------------------+
                   +--------------------+--------------------+
                   v                                         v
      +-------------------------+               +-------------------------+
      |   Worker Replica #1..N  |  ... scaled   |   Worker Replica #N     |
      |   (concurrency = 4)     |  horizontally |   (concurrency = 4)     |
      +------------+------------+               +------------+------------+
                   | docker run (--network=none,             |
                   |   --read-only, 256MB, 0.5 CPU,          |
                   |   64 PIDs, non-root user)               |
                   v                                         v
      +-------------------------+               +-------------------------+
      | Ephemeral Sandbox Image |               | Ephemeral Sandbox Image |
      | C++20 / Python / Node   |               | C++20 / Python / Node   |
      +-------------------------+               +-------------------------+
```

## Core Engineering Highlights

| Capability | Implementation |
|---|---|
| **Zero Untrusted Code on API** | `apps/api` validates input with Zod, writes a `QUEUED` record to MongoDB, and pushes jobs to BullMQ. Only isolated worker replicas invoke Docker sandboxes. |
| **Hardened Execution Sandboxes** | Non-root Alpine images (`sandbox-cpp`, `sandbox-py`, `sandbox-js`) launched with `--network=none`, `--read-only`, `--memory=256m`, `--memory-swap=256m`, `--cpus=0.5`, `--pids-limit=64`, and strict timeout `SIGKILL`. |
| **Public & Hidden Test Security** | Hidden test inputs, expected outputs, and candidate stdout diffs are stripped inside the worker before persisting or emitting WebSocket verdicts. |
| **Real-Time Interview Rooms** | React + Monaco Editor synced over Socket.IO (`code:change`, `lang:change`, `cursor:move`, live `submission:verdict`), with role-gated UI hiding Co-Pilot, Rubric, and Replay from candidates. |
| **S3 Chronological Replay** | Throttled code edits, submissions, verdicts, and rubric updates are stored as monotonically sequenced JSON objects in S3-compatible object storage (`interview-replays` bucket) and scrubbed in the Interviewer UI. |
| **Human-in-the-Loop AI Co-Pilot** | OpenAI-compatible LLM integration (Gemini / OpenAI / Groq + deterministic offline fallback) with strict Zod output validation for JD-to-Blueprint generation, complexity/failure diagnosis, and **non-autonomous** rubric evidence summaries. |

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- Docker Desktop (running with Linux containers / WSL 2)

### 1. Configure & Install
```bash
cp .env.example .env
npm install
```
*(Optional: set `LLM_API_KEY` in `.env` for live Gemini/OpenAI responses; leaving it blank uses the built-in deterministic fallback analyzer.)*

### 2. Start Infrastructure & Build Execution Sandboxes
```bash
npm run infra:up
npm run sandboxes:build
```

### 3. Run API, Worker, and Client
Open 3 terminals at the repo root:
```bash
npm run dev:api     # http://localhost:4000
npm run dev:worker  # Local BullMQ execution worker
npm run dev:client  # http://localhost:5173
```

### 4. Verify End-to-End
```bash
npm run test:smoke
```

## Horizontal Worker Scaling & 1,000-Submission Stress Test

Stop the local `dev:worker` terminal, then launch **4 containerized worker replicas** (16 concurrent sandbox runners):

```bash
npm run workers:scale
```

Run the WebSocket latency + 1,000 queued submissions benchmark:

```bash
# Quick 100-submission check (~10-15s)
npm run test:stress:quick

# Full 1,000-submission stress test
npm run test:stress
```

Tear down scaled worker containers when done:
```bash
npm run workers:down
```

## Benchmark Results

> Replace this table with the output printed by `npm run test:stress` (also saved to `benchmarks/latest-results.json`).

| Metric | Measured Result | Target |
|---|---|---|
| Live Collaboration Sync (p95) | _Run `npm run test:stress`_ | < 250 ms |
| API Submission Enqueue (1,000 reqs) | _Run `npm run test:stress`_ | Zero untrusted exec on API |
| Horizontal Worker Drain (4 replicas) | _Run `npm run test:stress`_ | 1,000 queued submissions |
| Container Execution Runtime (p50 / p95) | _Run `npm run test:stress`_ | 256MB RAM / 0.5 CPU cap |

## API Reference

- `GET /api/problems` — List seeded DSA problems (test I/O omitted)
- `POST /api/rooms` & `GET /api/rooms/:code` — Create or fetch a live interview room
- `POST /api/submissions` & `GET /api/submissions/:id` — Enqueue isolated code execution & check verdicts
- `PATCH /api/rooms/:code/evaluation` — Save private interviewer notes & 4-axis rubric scores
- `GET /api/rooms/:code/replay` — Fetch full chronological S3 snapshot timeline
- `POST /api/copilot/blueprint` — Generate a human-reviewed assessment blueprint from a JD
- `POST /api/copilot/analyze` — Estimate Big-O complexity, diagnose test failures, and suggest adaptive follow-ups
- `POST /api/copilot/rooms/:code/evidence-summary` — Generate an evidence-only rubric report (strictly non-autonomous)
- `GET /api/metrics/queue` & `GET /api/metrics/room/:code` — Real-time BullMQ queue depth & latency percentiles
