import "server-only";
import fs from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand, HeadBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DATA_DIR } from "./db";

/**
 * Media storage. S3 (or any S3-compatible service such as R2 / MinIO) is the
 * primary backend. When S3_BUCKET is not configured we fall back to the local
 * disk so the app still works in development, and log a warning.
 */

const bucket = process.env.S3_BUCKET;
export const usingS3 = Boolean(bucket);

declare global {
  var __waS3: S3Client | undefined;
  var __waS3Warned: boolean | undefined;
}

function client(): S3Client {
  if (globalThis.__waS3) return globalThis.__waS3;
  globalThis.__waS3 = new S3Client({
    region: process.env.S3_REGION || process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return globalThis.__waS3;
}

const LOCAL_DIR = path.join(DATA_DIR, "media");

function warnLocal() {
  if (!globalThis.__waS3Warned) {
    globalThis.__waS3Warned = true;
    console.warn("[storage] S3_BUCKET is not set — storing media on local disk at", LOCAL_DIR);
  }
}

function safeLocalPath(key: string) {
  const p = path.resolve(LOCAL_DIR, key);
  if (!p.startsWith(LOCAL_DIR + path.sep)) throw new Error("invalid key");
  return p;
}

export async function putMedia(key: string, body: Buffer, contentType: string) {
  if (usingS3) {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return;
  }
  warnLocal();
  const p = safeLocalPath(key);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, body);
}

export async function deleteMedia(key: string) {
  if (usingS3) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  await fs.promises.rm(safeLocalPath(key), { force: true });
}

/** Short-lived URL the browser can fetch directly (supports HTTP range for video/audio). */
export async function signedMediaUrl(key: string, opts: { download?: string; contentType?: string } = {}) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: opts.download
        ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`
        : undefined,
    }),
    { expiresIn: 60 * 60 },
  );
}

export function localMediaPath(key: string) {
  return safeLocalPath(key);
}

export async function checkStorage(): Promise<{ backend: "s3" | "local"; ok: boolean; error?: string; bucket?: string }> {
  if (!usingS3) return { backend: "local", ok: true };
  try {
    await client().send(new HeadBucketCommand({ Bucket: bucket }));
    return { backend: "s3", ok: true, bucket };
  } catch (e) {
    return { backend: "s3", ok: false, bucket, error: (e as Error).name + ": " + (e as Error).message };
  }
}

export function extFromMime(mime: string | null | undefined): string {
  if (!mime) return "bin";
  const m = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/webm": "webm",
    "audio/wav": "wav",
    "application/pdf": "pdf",
  };
  return map[m] || m.split("/")[1]?.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}
