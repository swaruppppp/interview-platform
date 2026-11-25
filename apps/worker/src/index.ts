import dotenv from "dotenv";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Worker } from "bullmq";
import Redis from "ioredis";
import mongoose from "mongoose";
import type {
  SubmissionJobPayload,
  SubmissionVerdictEvent,
  TestCaseResult,
  VerdictStatus,
} from "@platform/shared";
import { runContainer } from "./sandbox.js";

const execFileAsync = promisify(execFile);

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/interview_platform";
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);
const IN_DOCKER = process.env.IN_DOCKER === "true";
const CONTAINER_RUNS_ROOT = process.env.SANDBOX_RUNS_ROOT ?? path.resolve(process.cwd(), ".tmp-runs");
const WORKER_ID = os.hostname().slice(0, 12);

async function resolveHostRunsRoot(): Promise<string> {
  if (process.env.HOST_RUNS_ROOT) return process.env.HOST_RUNS_ROOT;
  if (!IN_DOCKER) return CONTAINER_RUNS_ROOT;

  const { stdout } = await execFileAsync("docker", [
    "inspect",
    os.hostname(),
    "--format",
    '{{range .Mounts}}{{if eq .Destination "/tmp-runs"}}{{.Source}}{{end}}{{end}}',
  ]);
  const hostPath = stdout.trim();
  if (!hostPath) {
    throw new Error("Could not resolve host bind-mount source for /tmp-runs via docker inspect");
  }
  return hostPath;
}

const HOST_RUNS_ROOT = await resolveHostRunsRoot();
await fs.mkdir(CONTAINER_RUNS_ROOT, { recursive: true });

const redisConn = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const redisPub = new Redis(REDIS_URL);

const SubmissionSchema = new mongoose.Schema(
  {
    status: String,
    passedCount: Number,
    totalCount: Number,
    maxRuntimeMs: Number,
    results: Array,
    compileError: String,
    completedAt: Date,
  },
  { strict: false, timestamps: true }
);
const SubmissionModel = mongoose.model("Submission", SubmissionSchema);

await mongoose.connect(MONGO_URI);
console.log(
  `[worker:${WORKER_ID}] Ready (concurrency=${WORKER_CONCURRENCY}, inDocker=${IN_DOCKER}, mount=${HOST_RUNS_ROOT})`
);

const LANG_CONFIG = {
  cpp: { file: "solution.cpp", image: "sandbox-cpp" },
  python: { file: "solution.py", image: "sandbox-py" },
  javascript: { file: "solution.js", image: "sandbox-js" },
} as const;

const worker = new Worker<SubmissionJobPayload>(
  "code-submissions",
  async (job) => {
    const { submissionId, roomCode, language, code, timeLimitMs, testCases } = job.data;
    const cfg = LANG_CONFIG[language];
    const containerWorkDir = path.join(CONTAINER_RUNS_ROOT, submissionId);
    const hostWorkDir = IN_DOCKER
      ? path.posix.join(HOST_RUNS_ROOT, submissionId)
      : path.join(HOST_RUNS_ROOT, submissionId);

    await fs.mkdir(containerWorkDir, { recursive: true });
    await fs.chmod(containerWorkDir, 0o777).catch(() => {});
    await fs.writeFile(path.join(containerWorkDir, cfg.file), code, "utf8");
    await SubmissionModel.findByIdAndUpdate(submissionId, { status: "RUNNING" });

    try {
      if (language === "cpp" && process.env.SANDBOX_MODE === "docker") {
        const comp = await runContainer(
          cfg.image,
          hostWorkDir,
          ["g++", "-O2", "-std=c++20", "solution.cpp", "-o", "solution"],
          "",
          10_000,
          false
        );

        if (comp.exitCode !== 0 || comp.timedOut) {
          const event: SubmissionVerdictEvent = {
            submissionId,
            roomCode,
            status: "CE",
            passedCount: 0,
            totalCount: testCases.length,
            maxRuntimeMs: comp.runtimeMs,
            results: [],
            compileError: comp.stderr || "Compilation timed out",
          };
          await persistAndPublish(event);
          return event;
        }
      }

      const runCmd =
        language === "cpp"
          ? ["./solution"]
          : language === "python"
          ? ["python3", "solution.py"]
          : ["node", "solution.js"];

      const results: TestCaseResult[] = [];
      let overallStatus: VerdictStatus = "AC";
      let passedCount = 0;
      let maxRuntimeMs = 0;

      for (const tc of testCases) {
        const exec = await runContainer(cfg.image, hostWorkDir, runCmd, tc.input, timeLimitMs, true, code);
        maxRuntimeMs = Math.max(maxRuntimeMs, exec.runtimeMs);

        let tcStatus: VerdictStatus = "AC";
        if (exec.timedOut) {
          tcStatus = "TLE";
        } else if (exec.exitCode !== 0) {
          tcStatus = "RE";
        } else if (exec.stdout.replace(/\r\n/g, "\n") !== tc.expectedOutput.trim().replace(/\r\n/g, "\n")) {
          tcStatus = "WA";
        }

        const passed = tcStatus === "AC";
        if (passed) passedCount++;
        else if (overallStatus === "AC") overallStatus = tcStatus;

        results.push({
          testCaseId: tc.id,
          isHidden: tc.isHidden,
          passed,
          status: tcStatus,
          runtimeMs: exec.runtimeMs,
          ...(tc.isHidden
            ? {}
            : {
                actualOutput: exec.stdout,
                expectedOutput: tc.expectedOutput.trim(),
                stderr: exec.stderr || undefined,
              }),
        });
      }

      const event: SubmissionVerdictEvent = {
        submissionId,
        roomCode,
        status: overallStatus,
        passedCount,
        totalCount: testCases.length,
        maxRuntimeMs,
        results,
      };
      await persistAndPublish(event);
      return event;
    } finally {
      await fs.rm(containerWorkDir, { recursive: true, force: true });
    }
  },
  { connection: redisConn, concurrency: WORKER_CONCURRENCY }
);

async function persistAndPublish(event: SubmissionVerdictEvent) {
  await SubmissionModel.findByIdAndUpdate(event.submissionId, {
    status: event.status,
    passedCount: event.passedCount,
    totalCount: event.totalCount,
    maxRuntimeMs: event.maxRuntimeMs,
    results: event.results,
    compileError: event.compileError,
    completedAt: new Date(),
  });
  await redisPub.publish("submission:verdicts", JSON.stringify(event));
}

worker.on("completed", (job) => console.log(`[worker:${WORKER_ID}] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[worker:${WORKER_ID}] Job ${job?.id} failed:`, err.message));

async function shutdown() {
  console.log(`[worker:${WORKER_ID}] Shutting down gracefully...`);
  await worker.close();
  await mongoose.disconnect();
  redisConn.disconnect();
  redisPub.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import http from "node:http";
const HEALTH_PORT = Number(process.env.PORT ?? 0);
if (HEALTH_PORT > 0) {
  http.createServer((_req, res) => { res.writeHead(200); res.end("worker-ok"); }).listen(HEALTH_PORT);
}

import http from "node:http";
const __renderPort = Number(process.env.PORT || 10000);
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  })
  .listen(__renderPort, "0.0.0.0", () => {
    console.log(`[worker-health] Listening on 0.0.0.0:${__renderPort}`);
  });
