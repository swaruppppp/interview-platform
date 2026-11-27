import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Play,
  Copy,
  Check,
  Wifi,
  WifiOff,
  LogOut,
  Users,
  Terminal,
} from "lucide-react";
import type { Language, SubmissionVerdictEvent } from "@platform/shared";
import type { Socket } from "socket.io-client";
import { api, createRoomSocket, type RoomDTO, type SubmissionDTO } from "../lib/api";
import type { UserRole } from "./Lobby";
import { VerdictPanel } from "./VerdictPanel";
import { InterviewerDrawer } from "./InterviewerDrawer";

interface InterviewRoomProps {
  roomCode: string;
  role: UserRole;
  name: string;
  onLeave: () => void;
}

const MONACO_LANG: Record<Language, string> = {
  cpp: "cpp",
  python: "python",
  javascript: "javascript",
};

export function InterviewRoom({ roomCode, role, name, onLeave }: InterviewRoomProps) {
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [language, setLanguage] = useState<Language>("cpp");
  const [code, setCode] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionDTO[]>([]);
  const [activeVerdict, setActiveVerdict] = useState<SubmissionVerdictEvent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<string | null>(null);
  const [peerNotice, setPeerNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const isRemoteUpdateRef = useRef(false);

  // Load room state & initial submissions
  useEffect(() => {
    api
      .getRoom(roomCode)
      .then(({ room: loaded, submissions: subs }) => {
        setRoom(loaded);
        setLanguage(loaded.language);
        setCode(loaded.currentCode || loaded.problemId.starterCode[loaded.language] || "");
        setSubmissions(subs);
        if (subs[0]) {
          setActiveVerdict({
            submissionId: subs[0]._id,
            roomCode: subs[0].roomCode,
            status: subs[0].status,
            passedCount: subs[0].passedCount,
            totalCount: subs[0].totalCount,
            maxRuntimeMs: subs[0].maxRuntimeMs,
            results: subs[0].results,
            compileError: subs[0].compileError,
          });
        }
      })
      .catch((err) => setLoadError(err.message));
  }, [roomCode]);

  // Connect Socket.IO for live code sync, cursor awareness & verdict push
  useEffect(() => {
    const socket = createRoomSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("room:join", { roomCode, role, name });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("room:participant-joined", ({ name: peerName, role: peerRole }) => {
      setPeerNotice(`${peerName} (${peerRole}) joined`);
      setTimeout(() => setPeerNotice(null), 4000);
    });

    socket.on("code:update", ({ code: nextCode }) => {
      isRemoteUpdateRef.current = true;
      setCode(nextCode);
    });

    socket.on("lang:update", ({ language: nextLang, code: nextCode }) => {
      isRemoteUpdateRef.current = true;
      setLanguage(nextLang);
      setCode(nextCode);
    });

    socket.on("cursor:update", ({ name: peerName, position }) => {
      if (position?.lineNumber) {
        setRemoteCursor(`${peerName} @ Ln ${position.lineNumber}, Col ${position.column}`);
      }
    });

    socket.on("submission:queued", () => {
      setIsSubmitting(true);
    });

    socket.on("submission:verdict", (verdict: SubmissionVerdictEvent) => {
      setIsSubmitting(false);
      setActiveVerdict(verdict);
      api.getRoom(roomCode).then(({ submissions: fresh }) => setSubmissions(fresh)).catch(() => {});
    });

    return () => {
      socket.disconnect();
    };
  }, [roomCode, role, name]);

  function handleCodeChange(val: string | undefined) {
    const next = val ?? "";
    setCode(next);
    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      return;
    }
    socketRef.current?.emit("code:change", { roomCode, code: next, language });
  }

  function handleLanguageChange(nextLang: Language) {
    if (!room) return;
    const starter = room.problemId.starterCode[nextLang] ?? "";
    setLanguage(nextLang);
    setCode(starter);
    socketRef.current?.emit("lang:change", {
      roomCode,
      language: nextLang,
      starterCode: starter,
    });
  }

  async function handleSubmit() {
    if (!room || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await api.submitCode({
        roomCode,
        problemId: room.problemId._id,
        language,
        code,
      });
    } catch (err) {
      setIsSubmitting(false);
      console.error(err);
    }
  }

  function copyShareLink() {
    const url = `${window.location.origin}/?room=${roomCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-rose-400 text-sm">Failed to load room {roomCode}: {loadError}</p>
        <button onClick={onLeave} className="px-4 py-2 rounded-lg bg-zinc-800 text-xs text-white">
          Back to Lobby
        </button>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-zinc-400">
        Loading room {roomCode}...
      </div>
    );
  }

  const problem = room.problemId;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top Navbar */}
      <header className="h-12 shrink-0 border-b border-zinc-800 bg-zinc-900/90 px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm text-white flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-blue-400" />
            CodeAssess
          </span>

          <button
            onClick={copyShareLink}
            title="Copy shareable room link"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-700 hover:border-blue-500 text-xs font-mono text-blue-300 transition"
          >
            Room: {roomCode}
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <span
            className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
              role === "interviewer"
                ? "bg-blue-500/15 text-blue-300 border border-blue-500/30"
                : "bg-blue-500/10 text-blue-300 border border-blue-500/25"
            }`}
          >
            {role}: {name}
          </span>

          {peerNotice && (
            <span className="flex items-center gap-1 text-xs text-emerald-300 animate-pulse">
              <Users className="w-3.5 h-3.5" />
              {peerNotice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {remoteCursor && (
            <span className="hidden lg:inline text-[11px] font-mono text-zinc-400">
              {remoteCursor}
            </span>
          )}

          <span
            className={`flex items-center gap-1 text-xs ${
              connected ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? "Live" : "Offline"}
          </span>

          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as Language)}
            className="px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="cpp">C++20 (g++)</option>
            <option value="python">Python 3.12</option>
            <option value="javascript">JavaScript (Node 22)</option>
          </select>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 transition"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isSubmitting ? "Running..." : "Run & Submit"}
          </button>

          <button
            onClick={onLeave}
            title="Leave room"
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex-1 flex min-h-0">
        {/* Left Pane: Problem Description + Live Test Verdicts */}
        <section className="w-[340px] shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col overflow-y-auto p-4 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-base font-bold text-white">{problem.title}</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {problem.difficulty}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-zinc-300">{problem.description}</p>
            <div className="text-[11px] text-zinc-500 font-mono">
              Limits: {problem.timeLimitMs}ms · 256MB RAM · 0.5 CPU · Network Disabled
            </div>
          </div>

          <hr className="border-zinc-800" />

          <VerdictPanel
            activeVerdict={activeVerdict}
            isSubmitting={isSubmitting}
            submissions={submissions}
            onSelectSubmission={(sub) => {
              setActiveVerdict({
                submissionId: sub._id,
                roomCode: sub.roomCode,
                status: sub.status,
                passedCount: sub.passedCount,
                totalCount: sub.totalCount,
                maxRuntimeMs: sub.maxRuntimeMs,
                results: sub.results,
                compileError: sub.compileError,
              });
            }}
          />
        </section>

        {/* Center Pane: Collaborative Monaco Editor */}
        <main className="flex-1 min-w-0 flex flex-col">
          <Editor
            height="100%"
            theme="vs-dark"
            language={MONACO_LANG[language]}
            value={code}
            onChange={handleCodeChange}
            onMount={(editor) => {
              editor.onDidChangeCursorPosition((e) => {
                socketRef.current?.emit("cursor:move", {
                  roomCode,
                  position: e.position,
                  name,
                });
              });
            }}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              tabSize: 2,
              padding: { top: 14 },
            }}
          />
        </main>

        {/* Right Drawer: Interviewer-only AI Co-Pilot, Rubric & S3 Replay */}
        {role === "interviewer" && (
          <InterviewerDrawer
            roomCode={roomCode}
            language={language}
            currentCode={code}
            latestSubmissionId={submissions[0]?._id}
            initialRubric={room.rubric}
            initialNotes={room.interviewerNotes}
            initialBlueprint={room.blueprint}
          />
        )}
      </div>
    </div>
  );
}
