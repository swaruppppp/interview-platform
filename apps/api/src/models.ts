import mongoose from "mongoose";

const TestCaseSchema = new mongoose.Schema({
  id: { type: String, required: true },
  input: { type: String, required: true },
  expectedOutput: { type: String, required: true },
  isHidden: { type: Boolean, default: false },
});

const ProblemSchema = new mongoose.Schema({
  slug: { type: String, unique: true, required: true },
  title: { type: String, required: true },
  difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], required: true },
  description: { type: String, required: true },
  timeLimitMs: { type: Number, default: 2000 },
  starterCode: {
    cpp: String,
    python: String,
    javascript: String,
  },
  testCases: [TestCaseSchema],
});

const RoomSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, required: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: "Problem", required: true },
    language: { type: String, enum: ["cpp", "python", "javascript"], default: "cpp" },
    currentCode: { type: String, default: "" },
    interviewerNotes: { type: String, default: "" },
    rubric: {
      problemSolving: { type: Number, min: 0, max: 5, default: 0 },
      codeQuality: { type: Number, min: 0, max: 5, default: 0 },
      complexityAnalysis: { type: Number, min: 0, max: 5, default: 0 },
      communication: { type: Number, min: 0, max: 5, default: 0 },
    },
    snapshotSeq: { type: Number, default: 0 },
    skipSnapshots: { type: Boolean, default: false },
    blueprint: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const SubmissionSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, index: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: "Problem", required: true },
    language: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, default: "QUEUED" },
    passedCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    maxRuntimeMs: { type: Number, default: 0 },
    results: { type: Array, default: [] },
    compileError: String,
    completedAt: Date,
  },
  { timestamps: true }
);

export const ProblemModel = mongoose.model("Problem", ProblemSchema);
export const RoomModel = mongoose.model("Room", RoomSchema);
export const SubmissionModel = mongoose.model("Submission", SubmissionSchema);
