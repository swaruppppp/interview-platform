import { io, type Socket } from "socket.io-client";
import type {
  AssessmentBlueprint,
  ComplexityFailureAnalysis,
  Language,
  ReplaySnapshot,
  RubricEvidenceSummary,
  RubricScores,
  TestCaseResult,
  VerdictStatus,
} from "@platform/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export interface ProblemDTO {
  _id: string;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  description: string;
  timeLimitMs: number;
  starterCode: Record<Language, string>;
  testCases: Array<{ id: string; isHidden: boolean; input?: string; expectedOutput?: string }>;
}

export interface SubmissionDTO {
  _id: string;
  roomCode: string;
  problemId: string;
  language: Language;
  code: string;
  status: VerdictStatus;
  passedCount: number;
  totalCount: number;
  maxRuntimeMs: number;
  results: TestCaseResult[];
  compileError?: string;
  createdAt: string;
}

export interface RoomDTO {
  _id: string;
  code: string;
  problemId: ProblemDTO;
  language: Language;
  currentCode: string;
  interviewerNotes: string;
  rubric: RubricScores;
  blueprint?: AssessmentBlueprint | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ? (typeof data.error === "string" ? data.error : JSON.stringify(data.error)) : `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  getProblems: () => request<ProblemDTO[]>("/api/problems"),

  createRoom: (problemId?: string) =>
    request<{ room: RoomDTO; problem: ProblemDTO }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify(problemId ? { problemId } : {}),
    }),

  getRoom: (code: string) =>
    request<{ room: RoomDTO; submissions: SubmissionDTO[] }>(`/api/rooms/${encodeURIComponent(code)}`),

  submitCode: (payload: { roomCode: string; problemId: string; language: Language; code: string }) =>
    request<{ submissionId: string; status: VerdictStatus }>("/api/submissions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  saveEvaluation: (code: string, payload: { interviewerNotes: string; rubric: RubricScores }) =>
    request<{ roomCode: string; rubric: RubricScores; interviewerNotes: string }>(
      `/api/rooms/${encodeURIComponent(code)}/evaluation`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),

  getReplay: (code: string) =>
    request<{ roomCode: string; count: number; snapshots: ReplaySnapshot[] }>(
      `/api/rooms/${encodeURIComponent(code)}/replay`
    ),

  generateBlueprint: (payload: {
    jobDescription: string;
    seniority?: string;
    durationMinutes?: number;
    roomCode?: string;
  }) =>
    request<{ mode: "llm" | "fallback"; blueprint: AssessmentBlueprint }>("/api/copilot/blueprint", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  analyzeCode: (payload: { submissionId?: string; roomCode?: string; language?: Language; code?: string }) =>
    request<{ mode: "llm" | "fallback"; analysis: ComplexityFailureAnalysis }>("/api/copilot/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getEvidenceSummary: (code: string) =>
    request<{ mode: "llm" | "fallback"; summary: RubricEvidenceSummary }>(
      `/api/copilot/rooms/${encodeURIComponent(code)}/evidence-summary`,
      { method: "POST" }
    ),
};

export function createRoomSocket(): Socket {
  return io(API_BASE, { transports: ["websocket", "polling"] });
}
