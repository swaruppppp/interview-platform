import { CheckCircle2, XCircle, Clock, Loader2, Lock, AlertTriangle } from "lucide-react";
import type { SubmissionVerdictEvent, VerdictStatus } from "@platform/shared";
import type { SubmissionDTO } from "../lib/api";

interface VerdictPanelProps {
  activeVerdict: SubmissionVerdictEvent | null;
  isSubmitting: boolean;
  submissions: SubmissionDTO[];
  onSelectSubmission?: (sub: SubmissionDTO) => void;
}

const STATUS_STYLE: Record<VerdictStatus, string> = {
  QUEUED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  RUNNING: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  AC: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  WA: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  TLE: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  CE: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  RE: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function VerdictPanel({
  activeVerdict,
  isSubmitting,
  submissions,
  onSelectSubmission,
}: VerdictPanelProps) {
  return (
    <div className="space-y-4">
      {isSubmitting && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Queued on BullMQ — executing inside isolated Docker container...
        </div>
      )}

      {activeVerdict && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-lg p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${
                STATUS_STYLE[activeVerdict.status]
              }`}
            >
              {activeVerdict.status}
            </span>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span>
                Passed{" "}
                <strong className="text-white">
                  {activeVerdict.passedCount}/{activeVerdict.totalCount}
                </strong>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {activeVerdict.maxRuntimeMs}ms
              </span>
            </div>
          </div>

          {activeVerdict.compileError && (
            <div className="p-2.5 rounded bg-zinc-950/50 border border-zinc-500/30 text-zinc-200 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
              <div className="flex items-center gap-1.5 font-sans font-semibold mb-1 text-zinc-300">
                <AlertTriangle className="w-3.5 h-3.5" />
                Compilation Error
              </div>
              {activeVerdict.compileError}
            </div>
          )}

          {activeVerdict.results.length > 0 && (
            <div className="space-y-2">
              {activeVerdict.results.map((tc) => (
                <div
                  key={tc.testCaseId}
                  className="p-2.5 rounded-md bg-zinc-950 border border-zinc-800 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-medium text-zinc-200">
                      {tc.passed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      )}
                      <span>{tc.testCaseId}</span>
                      {tc.isHidden && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">
                          <Lock className="w-2.5 h-2.5" /> Hidden
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {tc.status} · {tc.runtimeMs}ms
                    </span>
                  </div>

                  {!tc.isHidden && !tc.passed && (
                    <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                      <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-sans">Expected</div>
                        <div className="text-emerald-300 whitespace-pre-wrap">{tc.expectedOutput}</div>
                      </div>
                      <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-sans">Actual</div>
                        <div className="text-rose-300 whitespace-pre-wrap">
                          {tc.actualOutput || tc.stderr || "(empty)"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submission History */}
      {submissions.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">
            Recent Submissions ({submissions.length})
          </h3>
          <div className="space-y-1">
            {submissions.slice(0, 8).map((sub) => (
              <button
                key={sub._id}
                onClick={() => onSelectSubmission?.(sub)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800/80 text-xs transition"
              >
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${STATUS_STYLE[sub.status]}`}>
                    {sub.status}
                  </span>
                  <span className="font-mono text-zinc-300">{sub.language}</span>
                </div>
                <span className="text-[11px] text-zinc-400">
                  {sub.passedCount}/{sub.totalCount} · {sub.maxRuntimeMs}ms
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
