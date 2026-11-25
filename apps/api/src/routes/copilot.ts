import { Router } from "express";
import { z } from "zod";
import type { Language, TestCaseResult, VerdictStatus } from "@platform/shared";
import { ProblemModel, RoomModel, SubmissionModel } from "../models.js";
import {
  analyzeCodeForInterviewer,
  generateBlueprintFromJD,
  generateRubricEvidenceSummary,
} from "../copilot.js";

export const copilotRouter = Router();

const BlueprintReqSchema = z.object({
  jobDescription: z.string().min(20, "Provide at least 20 characters of JD text"),
  seniority: z.string().optional(),
  durationMinutes: z.number().int().min(15).max(180).optional(),
  roomCode: z.string().optional(),
});

copilotRouter.post("/blueprint", async (req, res) => {
  const parsed = BlueprintReqSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await generateBlueprintFromJD(parsed.data);

    if (parsed.data.roomCode) {
      await RoomModel.updateOne(
        { code: parsed.data.roomCode.toUpperCase() },
        { blueprint: result.blueprint }
      );
    }

    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: "Co-Pilot blueprint generation failed", details: err.message });
  }
});

const AnalyzeReqSchema = z.object({
  submissionId: z.string().optional(),
  roomCode: z.string().optional(),
  language: z.enum(["cpp", "python", "javascript"]).optional(),
  code: z.string().optional(),
});

copilotRouter.post("/analyze", async (req, res) => {
  const parsed = AnalyzeReqSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    let submission = parsed.data.submissionId
      ? await SubmissionModel.findById(parsed.data.submissionId)
      : null;

    if (!submission && parsed.data.roomCode) {
      submission = await SubmissionModel.findOne({
        roomCode: parsed.data.roomCode.toUpperCase(),
      }).sort({ createdAt: -1 });
    }

    const problem = submission
      ? await ProblemModel.findById(submission.problemId)
      : parsed.data.roomCode
      ? await RoomModel.findOne({ code: parsed.data.roomCode.toUpperCase() })
          .populate("problemId")
          .then((r) => r?.problemId as any)
      : null;

    const code = parsed.data.code ?? submission?.code;
    const language = (parsed.data.language ?? submission?.language ?? "cpp") as Language;

    if (!code) {
      return res.status(400).json({ error: "Provide submissionId, roomCode with submissions, or raw code" });
    }

    const result = await analyzeCodeForInterviewer({
      problemTitle: problem?.title ?? "Custom Coding Problem",
      problemDescription: problem?.description ?? "",
      language,
      code,
      status: (submission?.status as VerdictStatus) ?? "QUEUED",
      passedCount: submission?.passedCount ?? 0,
      totalCount: submission?.totalCount ?? 0,
      maxRuntimeMs: submission?.maxRuntimeMs ?? 0,
      compileError: submission?.compileError ?? undefined,
      results: (submission?.results as TestCaseResult[]) ?? [],
    });

    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: "Co-Pilot analysis failed", details: err.message });
  }
});

copilotRouter.post("/rooms/:code/evidence-summary", async (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const room = await RoomModel.findOne({ code: roomCode }).populate("problemId");
  if (!room) return res.status(404).json({ error: "Room not found" });

  const submissions = await SubmissionModel.find({ roomCode })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  const problem = room.problemId as any;

  try {
    const result = await generateRubricEvidenceSummary({
      roomCode,
      problemTitle: problem?.title ?? "Technical Assessment",
      rubric: {
        problemSolving: room.rubric?.problemSolving ?? 0,
        codeQuality: room.rubric?.codeQuality ?? 0,
        complexityAnalysis: room.rubric?.complexityAnalysis ?? 0,
        communication: room.rubric?.communication ?? 0,
      },
      interviewerNotes: room.interviewerNotes ?? "",
      submissions: submissions.map((s) => ({
        language: s.language,
        status: s.status,
        passedCount: s.passedCount,
        totalCount: s.totalCount,
        maxRuntimeMs: s.maxRuntimeMs,
        createdAt: s.createdAt,
      })),
    });

    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: "Co-Pilot evidence summary failed", details: err.message });
  }
});
