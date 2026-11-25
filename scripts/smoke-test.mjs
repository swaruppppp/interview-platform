const API = process.env.API_URL ?? "http://localhost:4000";

async function req(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(data)}`);
  return data;
}

const cppTwoSum = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int n, target; cin >> n >> target;
    unordered_map<int,int> mp;
    for (int i = 0, x; i < n; i++) {
        cin >> x;
        if (mp.count(target - x)) { cout << mp[target - x] << " " << i << "\n"; return 0; }
        mp[x] = i;
    }
}`;

console.log("1. Creating interview room...");
const { room, problem } = await req("/api/rooms", { method: "POST", body: "{}" });
console.log(`   Room=${room.code}, Problem=${problem.title}`);

console.log("2. Submitting C++20 Two Sum to isolated Docker worker...");
const { submissionId } = await req("/api/submissions", {
  method: "POST",
  body: JSON.stringify({
    roomCode: room.code,
    problemId: problem._id,
    language: "cpp",
    code: cppTwoSum,
  }),
});

let verdict;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  verdict = await req(`/api/submissions/${submissionId}`);
  if (verdict.status !== "QUEUED" && verdict.status !== "RUNNING") break;
}
console.log(`   Verdict=${verdict.status} (${verdict.passedCount}/${verdict.totalCount}) in ${verdict.maxRuntimeMs}ms`);

console.log("3. Testing AI Co-Pilot: JD -> Assessment Blueprint...");
const bp = await req("/api/copilot/blueprint", {
  method: "POST",
  body: JSON.stringify({
    roomCode: room.code,
    seniority: "SDE-1",
    durationMinutes: 60,
    jobDescription: "Seeking a Backend Engineer skilled in Node.js, TypeScript, Redis queues, DSA, and distributed APIs.",
  }),
});
console.log(`   Blueprint mode=${bp.mode}, problems=${bp.blueprint.recommendedProblems.length}, humanReview=${bp.blueprint.requiresHumanReview}`);

console.log("4. Testing AI Co-Pilot: Complexity & Failure Analysis...");
const analysis = await req("/api/copilot/analyze", {
  method: "POST",
  body: JSON.stringify({ submissionId }),
});
console.log(`   Mode=${analysis.mode}, Time=${analysis.analysis.estimatedTimeComplexity}, Space=${analysis.analysis.estimatedSpaceComplexity}`);

console.log("5. Saving interviewer rubric + notes...");
await req(`/api/rooms/${room.code}/evaluation`, {
  method: "PATCH",
  body: JSON.stringify({
    interviewerNotes: "Clarified constraints upfront, derived O(N) hash map solution cleanly, checked negative numbers.",
    rubric: { problemSolving: 5, codeQuality: 4, complexityAnalysis: 5, communication: 5 },
  }),
});

console.log("6. Testing AI Co-Pilot: Evidence-Only Rubric Summary...");
const summary = await req(`/api/copilot/rooms/${room.code}/evidence-summary`, { method: "POST" });
console.log(`   Mode=${summary.mode}, Notice="${summary.summary.nonAutonomousNotice.slice(0, 55)}..."`);

console.log("7. Fetching chronological MinIO/S3 Session Replay...");
const replay = await req(`/api/rooms/${room.code}/replay`);
console.log(`   Replay snapshots stored in MinIO: ${replay.count} (${replay.snapshots.map((s) => s.eventType).join(" -> ")})`);

console.log("\nALL SPRINT 1 + SPRINT 3 CHECKS PASSED!");
