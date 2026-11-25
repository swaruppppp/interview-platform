import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Language, ReplaySnapshot, SnapshotEventType } from "@platform/shared";
import { RoomModel } from "./models.js";

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000";
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? "admin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? "password123";
const S3_BUCKET = process.env.S3_BUCKET ?? "interview-replays";

export const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
});

export async function ensureReplayBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
    console.log(`[storage] Created MinIO/S3 bucket: ${S3_BUCKET}`);
  }
}

const lastCodeSnapshotAt = new Map<string, number>();
const CODE_SNAPSHOT_THROTTLE_MS = 4000;

export async function recordSnapshot(params: {
  roomCode: string;
  eventType: SnapshotEventType;
  language: Language;
  code: string;
  meta?: Record<string, unknown>;
  throttle?: boolean;
}): Promise<ReplaySnapshot | null> {
  const { roomCode, eventType, language, code, meta, throttle = false } = params;

  if (throttle) {
    const now = Date.now();
    const prev = lastCodeSnapshotAt.get(roomCode) ?? 0;
    if (now - prev < CODE_SNAPSHOT_THROTTLE_MS) return null;
    lastCodeSnapshotAt.set(roomCode, now);
  }

  const updated = await RoomModel.findOneAndUpdate(
    { code: roomCode },
    { $inc: { snapshotSeq: 1 } },
    { new: true, projection: { snapshotSeq: 1 } }
  );
  if (!updated) return null;

  const seq = updated.snapshotSeq;
  const timestamp = new Date().toISOString();
  const snapshot: ReplaySnapshot = {
    seq,
    roomCode,
    timestamp,
    eventType,
    language,
    code,
    meta,
  };

  const paddedSeq = String(seq).padStart(6, "0");
  const key = `rooms/${roomCode}/snapshots/${paddedSeq}-${Date.now()}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: JSON.stringify(snapshot),
      ContentType: "application/json",
    })
  );

  return snapshot;
}

export async function getSessionReplay(roomCode: string): Promise<ReplaySnapshot[]> {
  const prefix = `rooms/${roomCode}/snapshots/`;
  const listed = await s3.send(
    new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
    })
  );

  const keys = (listed.Contents ?? [])
    .map((obj) => obj.Key)
    .filter((k): k is string => Boolean(k))
    .sort();

  const snapshots = await Promise.all(
    keys.map(async (key) => {
      const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      const bodyStr = await obj.Body?.transformToString("utf8");
      return bodyStr ? (JSON.parse(bodyStr) as ReplaySnapshot) : null;
    })
  );

  return snapshots
    .filter((s): s is ReplaySnapshot => s !== null)
    .sort((a, b) => a.seq - b.seq);
}
