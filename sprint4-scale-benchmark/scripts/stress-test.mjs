import fs from "node:fs/promises";
import path from "node:path";
import { io } from "socket.io-client";

const API = process.env.API_URL ?? "http://localhost:4000";

function getArg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

const TOTAL_SUBMISSIONS = Number(getArg("count", "1000"));
const ENQUEUE_CONCURRENCY = Number(getArg("concurrency", "50"));
const WS_EVENTS = Number(getArg("ws-events", "50"));
const FULL_TEST_SUITE = process.argv.includes("--all-tests");

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[idx].toFixed(2));
}

async function req(urlPath, options = {}) {
  const res = await fetch(`${API}${urlPath}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${urlPath}: ${JSON.stringify(data)}`);
  return data;
}

// Fast O(N) JavaScript Two Sum solution (no compile step; tests pure Docker isolation + BullMQ scale)
const JS_TWO_SUM = `const fs = require("fs");
const t = fs.readFileSync(0, "utf8").trim().split(/\s+/).map(Number);
const n = t[0], target = t[1], mp = new Map();
for (let i = 0; i < n; i++) {
  const x = t[2 + i];
  if (mp.has(target - x)) { console.log(mp.get(target - x) + " " + i); process.exit(0); }
  mp.set(x, i);
}`;

// --- BENCHMARK 1: Live Collaboration WebSocket Sync Latency (< 250ms target) ---
async function benchmarkWebSocket(roomCode) {
  console.log(`\n[1/2] Benchmarking Socket.IO Live Collaboration Latency (${WS_EVENTS} events)...`);
  const sender = io(API, { transports: ["websocket"] });
  const receiver = io(API, { transports: ["websocket"] });

  await Promise.all([
    new Promise((res) => sender.on("connect", res)),
    new Promise((res) => receiver.on("connect", res)),
  ]);

  sender.emit("room:join", { roomCode, role: "candidate", name: "BenchCandidate" });
  receiver.emit("room:join", { roomCode, role: "interviewer", name: "BenchInterviewer" });
  await new Promise((r) => setTimeout(r, 150));

  const latencies = [];

  for (let i = 0; i < WS_EVENTS; i++) {
    const start = performance.now();
    const received = new Promise((resolve) => {
      receiver.once("code:update", () => resolve(performance.now() - start));
    });
    sender.emit("code:change", {
      roomCode,
      code: `// sync tick ${i}\n${JS_TWO_SUM}`,
      language: "javascript",
      sentAt: Date.now(),
    });
    latencies.push(await received);
  }

  sender.disconnect();
  receiver.disconnect();

  const stats = {
    events: WS_EVENTS,
    p50Ms: pct(latencies, 50),
    p95Ms: pct(latencies, 95),
    maxMs: pct(latencies, 100),
    passedUnder250ms: pct(latencies, 95) < 250,
  };

  console.log(
    `   WS Sync Latency: p50=${stats.p50Ms}ms | p95=${stats.p95Ms}ms | max=${stats.maxMs}ms -> ${
      stats.passedUnder250ms ? "PASS (<250ms)" : "FAIL (>=250ms)"
    }`
  );
  return stats;
}

// --- BENCHMARK 2: Queued Submissions Stress Test (Default: 1,000 submissions) ---
async function benchmarkQueueStress(roomCode, problemId) {
  console.log(
    `\n[2/2] Stress Testing ${TOTAL_SUBMISSIONS} Queued Submissions (batch=${ENQUEUE_CONCURRENCY}, singleTestOnly=${!FULL_TEST_SUITE})...`
  );

  const enqueueLatencies = [];
  let enqueueErrors = 0;
  const enqueueStart = performance.now();

  for (let offset = 0; offset < TOTAL_SUBMISSIONS; offset += ENQUEUE_CONCURRENCY) {
    const size = Math.min(ENQUEUE_CONCURRENCY, TOTAL_SUBMISSIONS - offset);
    await Promise.all(
      Array.from({ length: size }, async () => {
        const t0 = performance.now();
        try {
          await req("/api/submissions", {
            method: "POST",
            body: JSON.stringify({
              roomCode,
              problemId,
              language: "javascript",
              code: JS_TWO_SUM,
              singleTestOnly: !FULL_TEST_SUITE,
            }),
          });
          enqueueLatencies.push(performance.now() - t0);
        } catch {
          enqueueErrors++;
        }
      })
    );
  }

  const enqueueDurationSec = (performance.now() - enqueueStart) / 1000;
  const enqueueRps = Number((TOTAL_SUBMISSIONS / enqueueDurationSec).toFixed(1));
  console.log(
    `   Enqueued ${TOTAL_SUBMISSIONS - enqueueErrors}/${TOTAL_SUBMISSIONS} in ${enqueueDurationSec.toFixed(
      2
    )}s (${enqueueRps} req/s | API p50=${pct(enqueueLatencies, 50)}ms, p95=${pct(enqueueLatencies, 95)}ms)`
  );

  // Monitor BullMQ drain until all submissions reach terminal verdict
  console.log("   Waiting for isolated Docker workers to drain all queued submissions...");
  let metrics;
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const [q, roomMetrics] = await Promise.all([
      req("/api/metrics/queue"),
      req(`/api/metrics/room/${roomCode}`),
    ]);
    metrics = roomMetrics;
    const elapsedSec = (performance.now() - enqueueStart) / 1000;
    const jobsPerSec = (roomMetrics.completed / elapsedSec).toFixed(1);
    console.log(
      `   [${elapsedSec.toFixed(0)}s] completed=${roomMetrics.completed}/${roomMetrics.total} | queue waiting=${
        q.waiting
      } active=${q.active} | throughput=${jobsPerSec} jobs/s`
    );
    if (roomMetrics.completed >= TOTAL_SUBMISSIONS - enqueueErrors) break;
  }

  const totalDrainSec = Number(((performance.now() - enqueueStart) / 1000).toFixed(2));
  const avgThroughput = Number((metrics.completed / totalDrainSec).toFixed(2));

  return {
    totalSubmissions: TOTAL_SUBMISSIONS,
    enqueueErrors,
    enqueueDurationSec: Number(enqueueDurationSec.toFixed(2)),
    enqueueRps,
    apiAcceptP50Ms: pct(enqueueLatencies, 50),
    apiAcceptP95Ms: pct(enqueueLatencies, 95),
    totalDrainSec,
    avgThroughputJobsPerSec: avgThroughput,
    verdicts: metrics.byStatus,
    e2eLatencyMs: metrics.e2eLatencyMs,
    containerExecMs: metrics.execRuntimeMs,
  };
}

// --- Run Suite ---
console.log(`Target API: ${API}`);
const { room, problem } = await req("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ skipSnapshots: true }),
});
console.log(`Benchmark Room: ${room.code} (Problem: ${problem.title})`);

const wsStats = await benchmarkWebSocket(room.code);
const queueStats = await benchmarkQueueStress(room.code, problem._id);

const report = {
  timestamp: new Date().toISOString(),
  wsCollaboration: wsStats,
  queueStress: queueStats,
};

await fs.mkdir(path.resolve(process.cwd(), "benchmarks"), { recursive: true });
await fs.writeFile(
  path.resolve(process.cwd(), "benchmarks/latest-results.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log("\n================ BENCHMARK SUMMARY (Paste into README.md) ================");
console.log("| Metric | Result | Target |");
console.log("|---|---|---|");
console.log(`| Live Collaboration Sync (p95) | ${wsStats.p95Ms} ms | < 250 ms |`);
console.log(`| API Submission Enqueue (${queueStats.totalSubmissions} reqs) | ${queueStats.enqueueRps} req/s (p95 ${queueStats.apiAcceptP95Ms} ms) | Zero untrusted exec on API |`);
console.log(`| Isolated Docker Worker Drain | ${queueStats.totalSubmissions} jobs in ${queueStats.totalDrainSec}s (${queueStats.avgThroughputJobsPerSec} jobs/s) | Horizontal scaling |`);
console.log(`| Container Execution Runtime (p50 / p95) | ${queueStats.containerExecMs.p50} ms / ${queueStats.containerExecMs.p95} ms | Isolated 256MB / 0.5 CPU |`);
console.log(`| Verdict Accuracy | ${JSON.stringify(queueStats.verdicts)} | 100% AC |`);
console.log("==========================================================================\n");
console.log("Saved JSON report to benchmarks/latest-results.json");
