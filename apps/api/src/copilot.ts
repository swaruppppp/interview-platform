import { z } from "zod";
import type {
  AssessmentBlueprint,
  ComplexityFailureAnalysis,
  Language,
  RubricEvidenceSummary,
  RubricScores,
  TestCaseResult,
  VerdictStatus,
} from "@platform/shared";

const LLM_BASE_URL = (process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL ?? "gemini-2.5-flash";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";

const BlueprintSchema = z.object({
  roleTitle: z.string(),
  seniority: z.string(),
  durationMinutes: z.number(),
  requiresHumanReview: z.literal(true),
  coreCompetencies: z.array(z.string()).min(1),
  recommendedProblems: z
    .array(
      z.object({
        title: z.string(),
        difficulty: z.enum(["Easy", "Medium", "Hard"]),
        topic: z.string(),
        promptSummary: z.string(),
        expectedComplexity: z.string(),
        hiddenEdgeCases: z.array(z.string()),
      })
    )
    .min(1),
  rubricAnchors: z.array(
    z.object({
      dimension: z.enum(["problemSolving", "codeQuality", "complexityAnalysis", "communication"]),
      strongSignal: z.string(),
      weakSignal: z.string(),
    })
  ),
  adaptiveQuestionBank: z.array(z.string()),
});

const AnalysisSchema = z.object({
  estimatedTimeComplexity: z.string(),
  estimatedSpaceComplexity: z.string(),
  complexityReasoning: z.string(),
  failureRootCause: z.string().nullable(),
  edgeCasesMissed: z.array(z.string()),
  adaptiveFollowUps: z.array(
    z.object({
      question: z.string(),
      targetSignal: z.string(),
    })
  ),
});

const EvidenceSummarySchema = z.object({
  nonAutonomousNotice: z.string(),
  sessionOverview: z.string(),
  rubricMapping: z.array(
    z.object({
      dimension: z.enum(["problemSolving", "codeQuality", "complexityAnalysis", "communication"]),
      interviewerScore: z.number(),
      observedEvidence: z.array(z.string()),
      missingEvidence: z.array(z.string()),
    })
  ),
  keyStrengths: z.array(z.string()),
  areasToProbeFurther: z.array(z.string()),
});

async function callStructuredLLM<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>
): Promise<T | null> {
  if (!LLM_API_KEY) return null;

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty content");

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return schema.parse(JSON.parse(cleaned));
}

export async function generateBlueprintFromJD(input: {
  jobDescription: string;
  seniority?: string;
  durationMinutes?: number;
}): Promise<{ mode: "llm" | "fallback"; blueprint: AssessmentBlueprint }> {
  const duration = input.durationMinutes ?? 60;
  const seniority = input.seniority ?? "SDE-1 / New Grad";

  const systemPrompt = `You are a senior technical interview architect. Convert the job description into a structured live coding assessment blueprint.
Return ONLY valid JSON matching this exact shape:
{
  "roleTitle": string,
  "seniority": string,
  "durationMinutes": number,
  "requiresHumanReview": true,
  "coreCompetencies": string[],
  "recommendedProblems": [{ "title": string, "difficulty": "Easy"|"Medium"|"Hard", "topic": string, "promptSummary": string, "expectedComplexity": string, "hiddenEdgeCases": string[] }],
  "rubricAnchors": [{ "dimension": "problemSolving"|"codeQuality"|"complexityAnalysis"|"communication", "strongSignal": string, "weakSignal": string }],
  "adaptiveQuestionBank": string[]
}`;

  const llmResult = await callStructuredLLM(
    systemPrompt,
    `Seniority: ${seniority}\nDuration: ${duration} min\nJob Description:\n${input.jobDescription}`,
    BlueprintSchema
  );

  if (llmResult) return { mode: "llm", blueprint: llmResult };

  const lower = input.jobDescription.toLowerCase();
  const isBackend = lower.includes("node") || lower.includes("backend") || lower.includes("distributed") || lower.includes("api");
  const blueprint: AssessmentBlueprint = {
    roleTitle: isBackend ? "Backend Software Engineer" : "Software Development Engineer",
    seniority,
    durationMinutes: duration,
    requiresHumanReview: true,
    coreCompetencies: [
      "Algorithmic Problem Solving & Data Structures",
      "Edge-Case & Overflow Discipline",
      isBackend ? "Concurrency, Queues & Fault Tolerance" : "Clean Modular Code & Debugging",
      "Time/Space Complexity Tradeoffs",
    ],
    recommendedProblems: [
      {
        title: "Subarray Sum Equals K (Prefix Sum + Hash Map)",
        difficulty: "Medium",
        topic: "Hashing & Prefix Sums",
        promptSummary: "Count contiguous subarrays summing to K with negative numbers allowed.",
        expectedComplexity: "O(N) time, O(N) space",
        hiddenEdgeCases: ["Negative integers breaking sliding window", "Zero-sum chains", "64-bit integer overflow"],
      },
      {
        title: "Sliding Window Rate Limiter",
        difficulty: "Medium",
        topic: "Queues & System Design Implementation",
        promptSummary: "Implement allowRequest(userId, timestamp) enforcing K requests per T-second window.",
        expectedComplexity: "O(1) amortized time per call",
        hiddenEdgeCases: ["Burst traffic at exact boundary timestamp", "Inactive user memory eviction"],
      },
    ],
    rubricAnchors: [
      {
        dimension: "problemSolving",
        strongSignal: "Clarifies constraints, identifies brute-force baseline, and derives O(N) invariant independently.",
        weakSignal: "Jumps into coding without validating negative values or scale constraints.",
      },
      {
        dimension: "codeQuality",
        strongSignal: "Clean naming, single-pass structure, zero dead branches, handles I/O cleanly.",
        weakSignal: "Off-by-one patches, duplicated logic, unclear variable names.",
      },
      {
        dimension: "complexityAnalysis",
        strongSignal: "Accurately states worst-case vs average hash map complexity and memory footprint.",
        weakSignal: "Confuses O(N) with O(N log N) or ignores auxiliary space.",
      },
      {
        dimension: "communication",
        strongSignal: "Narrates tradeoffs and dry-runs an edge case before clicking Submit.",
        weakSignal: "Silent during debugging and cannot explain why a test failed.",
      },
    ],
    adaptiveQuestionBank: [
      "What breaks if input values include negative numbers or exceed 32-bit signed integers?",
      "If memory is constrained to O(1) extra space, what time complexity tradeoff are you forced to accept?",
      "How would your data structure behave under adversarial hash collisions?",
    ],
  };

  return { mode: "fallback", blueprint };
}

export async function analyzeCodeForInterviewer(input: {
  problemTitle: string;
  problemDescription: string;
  language: Language;
  code: string;
  status: VerdictStatus;
  passedCount: number;
  totalCount: number;
  maxRuntimeMs: number;
  compileError?: string;
  results: TestCaseResult[];
}): Promise<{ mode: "llm" | "fallback"; analysis: ComplexityFailureAnalysis }> {
  const systemPrompt = `You are an interviewer co-pilot observing a live coding session.
Analyze the candidate's code and test verdict. Never give a hire/no-hire decision.
Return ONLY valid JSON matching:
{
  "estimatedTimeComplexity": string,
  "estimatedSpaceComplexity": string,
  "complexityReasoning": string,
  "failureRootCause": string | null,
  "edgeCasesMissed": string[],
  "adaptiveFollowUps": [{ "question": string, "targetSignal": string }]
}`;

  const userPrompt = JSON.stringify(input, null, 2);
  const llmResult = await callStructuredLLM(systemPrompt, userPrompt, AnalysisSchema);
  if (llmResult) return { mode: "llm", analysis: llmResult };

  const nestedLoop = /(for|while)[\s\S]*?(for|while)/.test(input.code);
  const usesHash = /(unordered_map|unordered_set|Map|Set|dict|\{\})/.test(input.code);
  const usesSort = /\.sort\(|std::sort|sort\(/.test(input.code);

  const estimatedTimeComplexity = nestedLoop
    ? "O(N^2)"
    : usesSort
    ? "O(N log N)"
    : "O(N)";
  const estimatedSpaceComplexity = usesHash ? "O(N)" : "O(1)";

  let failureRootCause: string | null = null;
  if (input.status === "CE") {
    failureRootCause = `Compilation error: ${input.compileError ?? "syntax or header mismatch"}`;
  } else if (input.status === "TLE") {
    failureRootCause = `Exceeded time limit (${input.maxRuntimeMs}ms); likely quadratic or unbounded loop.`;
  } else if (input.status === "RE") {
    failureRootCause = "Runtime error (out-of-bounds index, division by zero, or unhandled input parse).";
  } else if (input.status === "WA") {
    const failedHidden = input.results.filter((r) => !r.passed && r.isHidden).length;
    failureRootCause =
      failedHidden > 0
        ? `Passed public logic partially but failed ${failedHidden} hidden edge-case test(s) (check negatives, duplicates, or 64-bit overflow).`
        : "Output format or core logic mismatch on public test cases.";
  }

  return {
    mode: "fallback",
    analysis: {
      estimatedTimeComplexity,
      estimatedSpaceComplexity,
      complexityReasoning: nestedLoop
        ? "Detected nested iteration blocks over the input collection."
        : usesHash
        ? "Single linear pass with hash-based lookup structure."
        : "Linear scan or sorting-dominated pass.",
      failureRootCause,
      edgeCasesMissed:
        input.status === "AC"
          ? ["Check 64-bit integer overflow if constraints scale to 10^12", "Discuss worst-case hash collision degradation"]
          : ["Negative inputs / duplicate elements", "Boundary indices (0 and N-1)", "Empty or single-element input"],
      adaptiveFollowUps: [
        {
          question:
            estimatedTimeComplexity === "O(N^2)"
              ? "Can you reduce the inner scan using extra memory to hit O(N) time?"
              : "What happens to your space complexity if the input stream arrives unbounded online?",
          targetSignal: "Space-time tradeoff reasoning",
        },
        {
          question: "Walk me through your code line-by-line on an input containing duplicate negative numbers.",
          targetSignal: "Dry-run accuracy & debugging discipline",
        },
        {
          question: "If two valid pairs exist, how would you adapt your solution to return all unique pairs?",
          targetSignal: "Extensibility & edge-case generalization",
        },
      ],
    },
  };
}

export async function generateRubricEvidenceSummary(input: {
  roomCode: string;
  problemTitle: string;
  rubric: RubricScores;
  interviewerNotes: string;
  submissions: Array<{
    language: string;
    status: string;
    passedCount: number;
    totalCount: number;
    maxRuntimeMs: number;
    createdAt: Date | string;
  }>;
}): Promise<{ mode: "llm" | "fallback"; summary: RubricEvidenceSummary }> {
  const notice =
    "EVIDENCE SUMMARY ONLY: This report organizes observed session data against the rubric and does NOT make hiring decisions. Final judgment belongs strictly to human reviewers.";

  const systemPrompt = `You are a technical interview evidence synthesizer.
Map the interviewer's notes, rubric scores, and objective submission logs into factual evidence bullets.
STRICT RULE: NEVER recommend "hire", "no hire", "strong hire", or make any autonomous hiring decision.
Return ONLY valid JSON matching:
{
  "nonAutonomousNotice": string,
  "sessionOverview": string,
  "rubricMapping": [{ "dimension": "problemSolving"|"codeQuality"|"complexityAnalysis"|"communication", "interviewerScore": number, "observedEvidence": string[], "missingEvidence": string[] }],
  "keyStrengths": string[],
  "areasToProbeFurther": string[]
}`;

  const llmResult = await callStructuredLLM(systemPrompt, JSON.stringify(input, null, 2), EvidenceSummarySchema);
  if (llmResult) {
    llmResult.nonAutonomousNotice = notice;
    return { mode: "llm", summary: llmResult };
  }

  const totalSubs = input.submissions.length;
  const acSubs = input.submissions.filter((s) => s.status === "AC");
  const bestSub = acSubs[0] ?? input.submissions[0];
  const hasNotes = input.interviewerNotes.trim().length > 0;

  return {
    mode: "fallback",
    summary: {
      nonAutonomousNotice: notice,
      sessionOverview: `Room ${input.roomCode} (${input.problemTitle}): ${totalSubs} submission(s) recorded; ${acSubs.length} Accepted (AC). ${
        bestSub
          ? `Latest/best pass rate: ${bestSub.passedCount}/${bestSub.totalCount} in ${bestSub.maxRuntimeMs}ms (${bestSub.language}).`
          : "No code submissions executed yet."
      }`,
      rubricMapping: [
        {
          dimension: "problemSolving",
          interviewerScore: input.rubric.problemSolving,
          observedEvidence:
            totalSubs > 0
              ? [`Executed ${totalSubs} submission(s); achieved ${acSubs.length > 0 ? "AC across all public & hidden tests" : "partial test coverage"}.`]
              : ["No submissions logged yet."],
          missingEvidence: totalSubs <= 1 ? ["Iterative debugging trajectory across multiple attempts not observed."] : [],
        },
        {
          dimension: "codeQuality",
          interviewerScore: input.rubric.codeQuality,
          observedEvidence: bestSub
            ? [`Compiled and executed cleanly in ${bestSub.language} (${bestSub.status}).`]
            : ["No final code artifact submitted."],
          missingEvidence: hasNotes ? [] : ["Interviewer qualitative code-readability notes not yet entered."],
        },
        {
          dimension: "complexityAnalysis",
          interviewerScore: input.rubric.complexityAnalysis,
          observedEvidence: bestSub
            ? [`Measured peak runtime ${bestSub.maxRuntimeMs}ms under 256MB / 0.5 CPU sandbox cap.`]
            : ["No runtime benchmark recorded."],
          missingEvidence: ["Verify verbal Big-O explanation from interviewer notes."],
        },
        {
          dimension: "communication",
          interviewerScore: input.rubric.communication,
          observedEvidence: hasNotes
            ? [`Interviewer notes recorded: "${input.interviewerNotes.slice(0, 180)}"`]
            : ["No communication notes recorded yet."],
          missingEvidence: hasNotes ? [] : ["Add notes on candidate clarification questions and dry-run explanation."],
        },
      ],
      keyStrengths: [
        ...(acSubs.length > 0 ? [`Solved all ${bestSub.totalCount} public and hidden test cases under sandbox resource limits.`] : []),
        ...(hasNotes ? ["Interviewer recorded live qualitative observations."] : []),
      ],
      areasToProbeFurther: [
        ...(acSubs.length === 0 ? ["Candidate has not yet achieved AC on hidden edge cases."] : []),
        "Confirm candidate can generalize the solution under memory or streaming constraints in the next round.",
      ],
    },
  };
}
