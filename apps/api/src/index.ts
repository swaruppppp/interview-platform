import dotenv from "dotenv";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { Server } from "socket.io";
import { z } from "zod";
import type { Language, SubmissionJobPayload, SubmissionVerdictEvent } from "@platform/shared";
import { ProblemModel, RoomModel, SubmissionModel } from "./models.js";
import { seedProblemsIfEmpty } from "./seed.js";
import { ensureReplayBucket, getSessionReplay, recordSnapshot } from "./storage.js";
import { copilotRouter } from "./routes/copilot.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/interview_platform";

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const redisConn = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const redisSub = new Redis(REDIS_URL);
const submissionQueue = new Queue<SubmissionJobPayload>("code-submissions", {
  connection: redisConn,
});

const skipSnapshotRooms = new Set<string>();

await redisSub.subscribe("submission:verdicts");
redisSub.on("message", async (_channel, message) => {
  const verdict: SubmissionVerdictEvent = JSON.parse(message);
  io.to(verdict.roomCode).emit("submission:verdict", verdict);

  if (skipSnapshotRooms.has(verdict.roomCode)) return;

  const sub = await SubmissionModel.findById(verdict.submissionId).lean();
  if (sub) {
    recordSnapshot({
      roomCode: verdict.roomCode,
      eventType: "submission_verdict",
      language: sub.language as Language,
      code: sub.code,
      meta: {
        submissionId: verdict.submissionId,
        status: verdict.status,
        passedCount: verdict.passedCount,
        totalCount: verdict.totalCount,
        maxRuntimeMs: verdict.maxRuntimeMs,
      },
    }).catch((err) => console.error("[storage] Snapshot error:", err.message));
  }
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomCode, role, name }) => {
    const code = String(roomCode).toUpperCase();
    socket.join(code);
    socket.to(code).emit("room:participant-joined", { id: socket.id, role, name });
  });

  socket.on("code:change", async ({ roomCode, code, language, sentAt }) => {
    const room = String(roomCode).toUpperCase();
    socket.to(room).emit("code:update", { code, senderId: socket.id, sentAt });
    await RoomModel.updateOne({ code: room }, { currentCode: code });

    if (!skipSnapshotRooms.has(room)) {
      recordSnapshot({
        roomCode: room,
        eventType: "code_edit",
        language: (language ?? "cpp") as Language,
        code,
        throttle: true,
      }).catch(() => {});
    }
  });

  socket.on("lang:change", async ({ roomCode, language, starterCode }) => {
    const room = String(roomCode).toUpperCase();
    socket.to(room).emit("lang:update", { language, code: starterCode });
    await RoomModel.updateOne({ code: room }, { language, currentCode: starterCode });

    if (!skipSnapshotRooms.has(room)) {
      recordSnapshot({
        roomCode: room,
        eventType: "lang_change",
        language: language as Language,
        code: starterCode ?? "",
      }).catch(() => {});
    }
  });

  socket.on("cursor:move", ({ roomCode, position, name }) => {
    socket.to(String(roomCode).toUpperCase()).emit("cursor:update", {
      id: socket.id,
      position,
      name,
    });
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "interview-api", timestamp: new Date().toISOString() });
});

app.get("/api/problems", async (_req, res) => {
  const problems = await ProblemModel.find({}, { "testCases.input": 0, "testCases.expectedOutput": 0 });
  res.json(problems);
});

app.post("/api/rooms", async (req, res) => {
  const problem = req.body.problemId
    ? await ProblemModel.findById(req.body.problemId)
    : await ProblemModel.findOne();
  if (!problem) return res.status(404).json({ error: "No problem found" });

  const skipSnapshots = Boolean(req.body.skipSnapshots);
  const code = crypto.randomBytes(3).toString("hex").toUpperCase();
  const starterCode = problem.starterCode?.cpp ?? "";
  const room = await RoomModel.create({
    code,
    problemId: problem._id,
    language: "cpp",
    currentCode: starterCode,
    skipSnapshots,
  });

  if (skipSnapshots) {
    skipSnapshotRooms.add(code);
  } else {
    recordSnapshot({
      roomCode: code,
      eventType: "room_created",
      language: "cpp",
      code: starterCode,
      meta: { problemSlug: problem.slug },
    }).catch((err) => console.error("[storage] Initial snapshot failed:", err.message));
  }

  res.status(201).json({ room, problem });
});

app.get("/api/rooms/:code", async (req, res) => {
  const room = await RoomModel.findOne({ code: req.params.code.toUpperCase() }).populate("problemId");
  if (!room) return res.status(404).json({ error: "Room not found" });

  const submissions = await SubmissionModel.find({ roomCode: room.code }).sort({ createdAt: -1 }).limit(20);
  res.json({ room, submissions });
});

const EvaluationSchema = z.object({
  interviewerNotes: z.string().max(20000).optional(),
  rubric: z
    .object({
      problemSolving: z.number().min(0).max(5).optional(),
      codeQuality: z.number().min(0).max(5).optional(),
      complexityAnalysis: z.number().min(0).max(5).optional(),
      communication: z.number().min(0).max(5).optional(),
    })
    .optional(),
});

app.patch("/api/rooms/:code/evaluation", async (req, res) => {
  const parsed = EvaluationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const roomCode = req.params.code.toUpperCase();
  const room = await RoomModel.findOne({ code: roomCode });
  if (!room) return res.status(404).json({ error: "Room not found" });

  if (parsed.data.interviewerNotes !== undefined) {
    room.interviewerNotes = parsed.data.interviewerNotes;
  }
  if (parsed.data.rubric) {
    room.rubric = {
      problemSolving: parsed.data.rubric.problemSolving ?? room.rubric?.problemSolving ?? 0,
      codeQuality: parsed.data.rubric.codeQuality ?? room.rubric?.codeQuality ?? 0,
      complexityAnalysis: parsed.data.rubric.complexityAnalysis ?? room.rubric?.complexityAnalysis ?? 0,
      communication: parsed.data.rubric.communication ?? room.rubric?.communication ?? 0,
    };
  }
  await room.save();

  if (!room.skipSnapshots) {
    recordSnapshot({
      roomCode,
      eventType: "evaluation_updated",
      language: room.language as Language,
      code: room.currentCode,
      meta: { rubric: room.rubric },
    }).catch(() => {});
  }

  res.json({ roomCode, rubric: room.rubric, interviewerNotes: room.interviewerNotes });
});

app.get("/api/rooms/:code/replay", async (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const room = await RoomModel.findOne({ code: roomCode }, { code: 1, snapshotSeq: 1 });
  if (!room) return res.status(404).json({ error: "Room not found" });

  try {
    const snapshots = await getSessionReplay(roomCode);
    res.json({ roomCode, count: snapshots.length, snapshots });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch replay from S3", details: err.message });
  }
});

const SubmitSchema = z.object({
  roomCode: z.string().min(3),
  problemId: z.string().min(10),
  language: z.enum(["cpp", "python", "javascript"]),
  code: z.string().min(1).max(65536),
  singleTestOnly: z.boolean().optional(),
});

app.post("/api/submissions", async (req, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const roomCode = parsed.data.roomCode.toUpperCase();
  const problem = await ProblemModel.findById(parsed.data.problemId);
  if (!problem) return res.status(404).json({ error: "Problem not found" });

  const selectedTests = parsed.data.singleTestOnly
    ? problem.testCases.slice(0, 1)
    : problem.testCases;

  const submission = await SubmissionModel.create({
    roomCode,
    problemId: parsed.data.problemId,
    language: parsed.data.language,
    code: parsed.data.code,
    status: "QUEUED",
    totalCount: selectedTests.length,
  });

  if (!skipSnapshotRooms.has(roomCode)) {
    recordSnapshot({
      roomCode,
      eventType: "submission_queued",
      language: parsed.data.language,
      code: parsed.data.code,
      meta: { submissionId: submission._id.toString() },
    }).catch(() => {});
  }

  await submissionQueue.add("execute", {
    submissionId: submission._id.toString(),
    roomCode,
    problemId: problem._id.toString(),
    language: parsed.data.language,
    code: parsed.data.code,
    timeLimitMs: problem.timeLimitMs,
    testCases: selectedTests.map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      isHidden: tc.isHidden,
    })),
  });

  io.to(roomCode).emit("submission:queued", { submissionId: submission._id.toString() });
  res.status(202).json({ submissionId: submission._id.toString(), status: "QUEUED" });
});

app.get("/api/submissions/:id", async (req, res) => {
  const sub = await SubmissionModel.findById(req.params.id);
  if (!sub) return res.status(404).json({ error: "Submission not found" });
  res.json(sub);
});

// Sprint 4: Observability & Stress Test Telemetry
app.get("/api/metrics/queue", async (_req, res) => {
  const counts = await submissionQueue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed"
  );
  res.json(counts);
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

app.get("/api/metrics/room/:code", async (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const subs = await SubmissionModel.find(
    { roomCode },
    { status: 1, maxRuntimeMs: 1, createdAt: 1, updatedAt: 1, completedAt: 1 }
  ).lean();

  const byStatus: Record<string, number> = {};
  const e2eMs: number[] = [];
  const execMs: number[] = [];

  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.status !== "QUEUED" && s.status !== "RUNNING") {
      const doneAt = s.completedAt ? new Date(s.completedAt).getTime() : new Date(s.updatedAt).getTime();
      const createdAt = new Date(s.createdAt).getTime();
      e2eMs.push(Math.max(0, doneAt - createdAt));
      execMs.push(s.maxRuntimeMs ?? 0);
    }
  }

  e2eMs.sort((a, b) => a - b);
  execMs.sort((a, b) => a - b);

  const completed = subs.length - (byStatus.QUEUED ?? 0) - (byStatus.RUNNING ?? 0);

  res.json({
    roomCode,
    total: subs.length,
    completed,
    inFlight: subs.length - completed,
    byStatus,
    e2eLatencyMs: {
      p50: percentile(e2eMs, 50),
      p95: percentile(e2eMs, 95),
      max: e2eMs[e2eMs.length - 1] ?? 0,
    },
    execRuntimeMs: {
      p50: percentile(execMs, 50),
      p95: percentile(execMs, 95),
      max: execMs[execMs.length - 1] ?? 0,
    },
  });
});

app.use("/api/copilot", copilotRouter);

await mongoose.connect(MONGO_URI);
await seedProblemsIfEmpty();
await ensureReplayBucket().catch((e) => console.warn("[storage] S3 skipped:", e.message));

server.listen(PORT, () => console.log(`[api] Running on http://localhost:${PORT}`));
