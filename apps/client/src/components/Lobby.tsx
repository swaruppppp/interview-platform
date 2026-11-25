import { useEffect, useState } from "react";
import { Code2, PlusCircle, LogIn, ShieldCheck, UserCheck } from "lucide-react";
import { api, type ProblemDTO } from "../lib/api";

export type UserRole = "interviewer" | "candidate";

interface LobbyProps {
  initialRoomCode?: string;
  onEnterRoom: (roomCode: string, role: UserRole, name: string) => void;
}

export function Lobby({ initialRoomCode = "", onEnterRoom }: LobbyProps) {
  const [problems, setProblems] = useState<ProblemDTO[]>([]);
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [role, setRole] = useState<UserRole>(initialRoomCode ? "candidate" : "interviewer");
  const [name, setName] = useState(initialRoomCode ? "Candidate" : "Interviewer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProblems()
      .then((list) => {
        setProblems(list);
        if (list[0]) setSelectedProblemId(list[0]._id);
      })
      .catch((err) => setError(`Cannot reach API at localhost:4000 (${err.message})`));
  }, []);

  async function handleCreate() {
    setError(null);
    setLoading(true);
    try {
      const { room } = await api.createRoom(selectedProblemId || undefined);
      onEnterRoom(room.code, role, name.trim() || "Interviewer");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = joinCode.trim().toUpperCase();
    if (cleaned.length < 3) return;
    setError(null);
    setLoading(true);
    try {
      await api.getRoom(cleaned);
      onEnterRoom(cleaned, role, name.trim() || (role === "interviewer" ? "Interviewer" : "Candidate"));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            Isolated Docker Sandbox + Real-Time Sync + AI Co-Pilot
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center justify-center gap-2.5">
            <Code2 className="w-8 h-8 text-indigo-400" />
            CodeAssess Live Interview
          </h1>
          <p className="text-sm text-slate-400">
            Open two browser tabs — one as Interviewer and one as Candidate — using the same Room Code to test live collaboration.
          </p>
        </div>

        {/* Identity & Role Selector */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Display Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Session Role</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setRole("interviewer");
                  if (name === "Candidate") setName("Interviewer");
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                  role === "interviewer"
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                Interviewer
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole("candidate");
                  if (name === "Interviewer") setName("Candidate");
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                  role === "candidate"
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                Candidate
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {/* Create Room */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-indigo-400" />
                Start New Interview Room
              </h2>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Select Seeded Problem</label>
                <select
                  value={selectedProblemId}
                  onChange={(e) => setSelectedProblemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {problems.map((p) => (
                    <option key={p._id} value={p._id}>
                      [{p.difficulty}] {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={handleCreate}
              disabled={loading || problems.length === 0}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white transition"
            >
              {loading ? "Creating..." : "Create Room"}
            </button>
          </div>

          {/* Join Existing Room */}
          <form
            onSubmit={handleJoin}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <LogIn className="w-4 h-4 text-emerald-400" />
                Join Existing Room
              </h2>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">6-Character Room Code</label>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="e.g. A1B2C3"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono uppercase tracking-widest text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || joinCode.trim().length < 3}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold text-white transition"
            >
              Join Room
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
