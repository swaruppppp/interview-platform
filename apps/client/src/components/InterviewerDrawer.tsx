import { useEffect, useState } from "react";
import {
  Sparkles,
  ClipboardCheck,
  History,
  Play,
  Pause,
  Loader2,
  ShieldAlert,
  Save,
  RefreshCw,
} from "lucide-react";
import type {
  AssessmentBlueprint,
  ComplexityFailureAnalysis,
  Language,
  ReplaySnapshot,
  RubricEvidenceSummary,
  RubricScores,
} from "@platform/shared";
import { api } from "../lib/api";

interface InterviewerDrawerProps {
  roomCode: string;
  language: Language;
  currentCode: string;
  latestSubmissionId?: string;
  initialRubric: RubricScores;
  initialNotes: string;
  initialBlueprint?: AssessmentBlueprint | null;
}

type DrawerTab = "copilot" | "rubric" | "replay";

const RUBRIC_LABELS: Array<{ key: keyof RubricScores; label: string }> = [
  { key: "problemSolving", label: "Problem Solving" },
  { key: "codeQuality", label: "Code Quality" },
  { key: "complexityAnalysis", label: "Complexity Analysis" },
  { key: "communication", label: "Communication" },
];

export function InterviewerDrawer({
  roomCode,
  language,
  currentCode,
  latestSubmissionId,
  initialRubric,
  initialNotes,
  initialBlueprint,
}: InterviewerDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("copilot");

  // AI Co-Pilot state
  const [analysis, setAnalysis] = useState<{ mode: string; data: ComplexityFailureAnalysis } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [jdText, setJdText] = useState(
    "Seeking an SDE-1 / Backend Engineer proficient in C++/TypeScript, DSA, Redis queues, Docker sandboxing, and distributed APIs."
  );
  const [blueprint, setBlueprint] = useState<{ mode: string; data: AssessmentBlueprint } | null>(
    initialBlueprint ? { mode: "saved", data: initialBlueprint } : null
  );
  const [genBp, setGenBp] = useState(false);

  // Rubric & Evidence state
  const [rubric, setRubric] = useState<RubricScores>(initialRubric);
  const [notes, setNotes] = useState(initialNotes);
  const [savingEval, setSavingEval] = useState(false);
  const [evalSavedMsg, setEvalSavedMsg] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ mode: string; data: RubricEvidenceSummary } | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);

  // Replay state
  const [snapshots, setSnapshots] = useState<ReplaySnapshot[]>([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playing || snapshots.length === 0) return;
    const id = setInterval(() => {
      setReplayIdx((prev) => {
        if (prev >= snapshots.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1100);
    return () => clearInterval(id);
  }, [playing, snapshots.length]);

  async function handleAnalyze() {
    setError(null);
    setAnalyzing(true);
    try {
      const res = await api.analyzeCode(
        latestSubmissionId
          ? { submissionId: latestSubmissionId }
          : { roomCode, language, code: currentCode }
      );
      setAnalysis({ mode: res.mode, data: res.analysis });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleBlueprint() {
    setError(null);
    setGenBp(true);
    try {
      const res = await api.generateBlueprint({
        jobDescription: jdText,
        roomCode,
        seniority: "SDE-1",
        durationMinutes: 60,
      });
      setBlueprint({ mode: res.mode, data: res.blueprint });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenBp(false);
    }
  }

  async function handleSaveEvaluation() {
    setError(null);
    setSavingEval(true);
    setEvalSavedMsg(null);
    try {
      await api.saveEvaluation(roomCode, { interviewerNotes: notes, rubric });
      setEvalSavedMsg("Saved to MongoDB & S3 snapshot");
      setTimeout(() => setEvalSavedMsg(null), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEval(false);
    }
  }

  async function handleEvidenceSummary() {
    setError(null);
    setLoadingEvidence(true);
    try {
      await api.saveEvaluation(roomCode, { interviewerNotes: notes, rubric });
      const res = await api.getEvidenceSummary(roomCode);
      setEvidence({ mode: res.mode, data: res.summary });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingEvidence(false);
    }
  }

  async function handleLoadReplay() {
    setError(null);
    setLoadingReplay(true);
    setPlaying(false);
    try {
      const res = await api.getReplay(roomCode);
      setSnapshots(res.snapshots);
      setReplayIdx(Math.max(0, res.snapshots.length - 1));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingReplay(false);
    }
  }

  const activeSnap = snapshots[replayIdx];

  return (
    <aside className="w-[380px] shrink-0 border-l border-slate-800 bg-slate-900/70 flex flex-col h-full overflow-hidden">
      {/* Drawer Tabs */}
      <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-950/60">
        <button
          onClick={() => setTab("copilot")}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition ${
            tab === "copilot"
              ? "border-indigo-500 text-indigo-300 bg-indigo-500/5"
              : "border-transparent text-slate-400 hover:text-white"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Co-Pilot
        </button>
        <button
          onClick={() => setTab("rubric")}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition ${
            tab === "rubric"
              ? "border-indigo-500 text-indigo-300 bg-indigo-500/5"
              : "border-transparent text-slate-400 hover:text-white"
          }`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          Rubric
        </button>
        <button
          onClick={() => {
            setTab("replay");
            if (snapshots.length === 0) handleLoadReplay();
          }}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition ${
            tab === "replay"
              ? "border-indigo-500 text-indigo-300 bg-indigo-500/5"
              : "border-transparent text-slate-400 hover:text-white"
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Replay
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* TAB 1: AI CO-PILOT */}
        {tab === "copilot" && (
          <div className="space-y-5">
            {/* Code & Complexity Analyzer */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Live Code & Failure Analyzer
                </h3>
                {analysis && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                    {analysis.mode}
                  </span>
                )}
              </div>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center justify-center gap-2 transition"
              >
                {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Analyze {latestSubmissionId ? "Latest Submission" : "Current Code"}
              </button>

              {analysis && (
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2.5 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">Time Complexity</div>
                      <div className="font-mono font-bold text-indigo-300">
                        {analysis.data.estimatedTimeComplexity}
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-500">Space Complexity</div>
                      <div className="font-mono font-bold text-emerald-300">
                        {analysis.data.estimatedSpaceComplexity}
                      </div>
                    </div>
                  </div>
                  <p className="text-slate-300">{analysis.data.complexityReasoning}</p>
                  {analysis.data.failureRootCause && (
                    <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-200">
                      <strong>Failure Diagnosis:</strong> {analysis.data.failureRootCause}
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 mb-1">Adaptive Follow-Ups</div>
                    <ul className="space-y-1.5">
                      {analysis.data.adaptiveFollowUps.map((f, i) => (
                        <li key={i} className="p-2 rounded bg-slate-900/80 border border-slate-800">
                          <div className="text-slate-200">{f.question}</div>
                          <div className="text-[10px] text-indigo-400 mt-0.5">Signal: {f.targetSignal}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <hr className="border-slate-800" />

            {/* JD -> Assessment Blueprint */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                JD → Assessment Blueprint
              </h3>
              <textarea
                rows={3}
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                placeholder="Paste Job Description..."
              />
              <button
                onClick={handleBlueprint}
                disabled={genBp || jdText.trim().length < 20}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-white flex items-center justify-center gap-2 transition"
              >
                {genBp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Generate Blueprint (Human-Reviewed)
              </button>

              {blueprint && (
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{blueprint.data.roleTitle}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      Human Review Required
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {blueprint.data.coreCompetencies.map((c, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300">
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {blueprint.data.recommendedProblems.map((p, i) => (
                      <div key={i} className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="font-medium text-indigo-300">
                          {p.title} ({p.difficulty})
                        </div>
                        <div className="text-slate-400 text-[11px] mt-0.5">{p.promptSummary}</div>
                        <div className="text-[10px] text-emerald-400 font-mono mt-1">{p.expectedComplexity}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: RUBRIC & EVIDENCE */}
        {tab === "rubric" && (
          <div className="space-y-4">
            <div className="space-y-3">
              {RUBRIC_LABELS.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">{label}</span>
                    <span className="font-mono font-bold text-indigo-300">{rubric[key]} / 5</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={rubric[key]}
                    onChange={(e) => setRubric({ ...rubric, [key]: Number(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Interviewer Live Notes (Private)
              </label>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note clarification questions, tradeoffs discussed, debugging discipline..."
                className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleSaveEvaluation}
                disabled={savingEval}
                className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition"
              >
                <Save className="w-3.5 h-3.5" />
                {savingEval ? "Saving..." : "Save Rubric"}
              </button>
              <button
                onClick={handleEvidenceSummary}
                disabled={loadingEvidence}
                className="py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition"
              >
                {loadingEvidence ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Evidence Report
              </button>
            </div>

            {evalSavedMsg && <p className="text-[11px] text-emerald-400">{evalSavedMsg}</p>}

            {evidence && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-3 text-xs">
                <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>{evidence.data.nonAutonomousNotice}</span>
                </div>
                <p className="text-slate-300">{evidence.data.sessionOverview}</p>
                <div className="space-y-2">
                  {evidence.data.rubricMapping.map((item) => (
                    <div key={item.dimension} className="p-2 rounded bg-slate-900 border border-slate-800 space-y-1">
                      <div className="flex justify-between font-semibold text-slate-200">
                        <span>{item.dimension}</span>
                        <span className="text-indigo-300">{item.interviewerScore}/5</span>
                      </div>
                      {item.observedEvidence.map((ev, idx) => (
                        <div key={idx} className="text-[11px] text-emerald-300">+ {ev}</div>
                      ))}
                      {item.missingEvidence.map((m, idx) => (
                        <div key={idx} className="text-[11px] text-slate-400">? {m}</div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: S3 / MINIO SESSION REPLAY */}
        {tab === "replay" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                S3 Snapshots ({snapshots.length})
              </span>
              <button
                onClick={handleLoadReplay}
                disabled={loadingReplay}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3 h-3 ${loadingReplay ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            {snapshots.length > 0 && activeSnap ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (replayIdx >= snapshots.length - 1) setReplayIdx(0);
                      setPlaying((p) => !p);
                    }}
                    className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={snapshots.length - 1}
                    value={replayIdx}
                    onChange={(e) => {
                      setPlaying(false);
                      setReplayIdx(Number(e.target.value));
                    }}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-xs font-mono text-slate-400">
                    #{activeSnap.seq}/{snapshots.length}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-mono">
                      {activeSnap.eventType}
                    </span>
                    <span className="text-slate-500 font-mono">
                      {new Date(activeSnap.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  {activeSnap.meta && (
                    <pre className="text-[10px] text-slate-400 overflow-x-auto pt-1">
                      {JSON.stringify(activeSnap.meta, null, 2)}
                    </pre>
                  )}
                </div>

                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto max-h-[360px] whitespace-pre">
                  {activeSnap.code}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No snapshots loaded yet. Edit code or submit to capture replay frames in S3.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
