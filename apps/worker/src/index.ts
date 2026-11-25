import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
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

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/interview_platform";
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

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
  },
  { strict: false, timestamps: true }
);
const SubmissionModel = mongoose.model("Submission", SubmissionSchema);

await mongoose.connect(MONGO_URI);
console.log(`[worker] Connected to MongoDB & Redis (concurrency=${WORKER_CONCURRENCY})`);

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
    const workDir = path.resolve(process.cwd(), ".tmp-runs", submissionId);

    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, cfg.file), code, "utf8");
    await SubmissionModel.findByIdAndUpdate(submissionId, { status: "RUNNING" });

    try {
      if (language === "cpp") {
        const comp = await runContainer(
          cfg.image,
          workDir,
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
        const exec = await runContainer(cfg.image, workDir, runCmd, tc.input, timeLimitMs, true);
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
      await fs.rm(workDir, { recursive: true, force: true });
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
  });
  await redisPub.publish("submission:verdicts", JSON.stringify(event));
}

worker.on("completed", (job) => console.log(`[worker] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[worker] Job ${job?.id} failed:`, err.message));
