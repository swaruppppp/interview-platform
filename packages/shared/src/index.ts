export type Language = "cpp" | "python" | "javascript";

export type VerdictStatus =
  | "QUEUED"
  | "RUNNING"
  | "AC"   // Accepted
  | "WA"   // Wrong Answer
  | "TLE"  // Time Limit Exceeded
  | "CE"   // Compilation Error
  | "RE";  // Runtime Error

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

export interface TestCaseResult {
  testCaseId: string;
  isHidden: boolean;
  passed: boolean;
  status: VerdictStatus;
  runtimeMs: number;
  actualOutput?: string;
  expectedOutput?: string;
  stderr?: string;
}

export interface SubmissionJobPayload {
  submissionId: string;
  roomCode: string;
  problemId: string;
  language: Language;
  code: string;
  timeLimitMs: number;
  testCases: TestCase[];
}

export interface SubmissionVerdictEvent {
  submissionId: string;
  roomCode: string;
  status: VerdictStatus;
  passedCount: number;
  totalCount: number;
  maxRuntimeMs: number;
  results: TestCaseResult[];
  compileError?: string;
}

// --- Sprint 3: Rubric, Replay & AI Co-Pilot Contracts ---

export interface RubricScores {
  problemSolving: number;     // 0-5
  codeQuality: number;        // 0-5
  complexityAnalysis: number; // 0-5
  communication: number;      // 0-5
}

export type SnapshotEventType =
  | "room_created"
  | "code_edit"
  | "lang_change"
  | "submission_queued"
  | "submission_verdict"
  | "evaluation_updated";

export interface ReplaySnapshot {
  seq: number;
  roomCode: string;
  timestamp: string;
  eventType: SnapshotEventType;
  language: Language;
  code: string;
  meta?: Record<string, unknown>;
}

export interface AssessmentBlueprint {
  roleTitle: string;
  seniority: string;
  durationMinutes: number;
  requiresHumanReview: true;
  coreCompetencies: string[];
  recommendedProblems: Array<{
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    topic: string;
    promptSummary: string;
    expectedComplexity: string;
    hiddenEdgeCases: string[];
  }>;
  rubricAnchors: Array<{
    dimension: keyof RubricScores;
    strongSignal: string;
    weakSignal: string;
  }>;
  adaptiveQuestionBank: string[];
}

export interface ComplexityFailureAnalysis {
  estimatedTimeComplexity: string;
  estimatedSpaceComplexity: string;
  complexityReasoning: string;
  failureRootCause: string | null;
  edgeCasesMissed: string[];
  adaptiveFollowUps: Array<{
    question: string;
    targetSignal: string;
  }>;
}

export interface RubricEvidenceSummary {
  nonAutonomousNotice: string;
  sessionOverview: string;
  rubricMapping: Array<{
    dimension: keyof RubricScores;
    interviewerScore: number;
    observedEvidence: string[];
    missingEvidence: string[];
  }>;
  keyStrengths: string[];
  areasToProbeFurther: string[];
}
