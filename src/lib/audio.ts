import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
  });
}

/** Convert any browser-recorded audio (webm/opus, mp4/aac…) into a WhatsApp voice note: OGG/Opus mono 48k. */
export async function toVoiceNote(input: Buffer): Promise<{ buffer: Buffer; seconds: number }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wa-voice-"));
  const id = crypto.randomUUID();
  const inPath = path.join(dir, id + ".in");
  const outPath = path.join(dir, id + ".ogg");
  try {
    await fs.promises.writeFile(inPath, input);
    await run(FFMPEG, ["-y", "-i", inPath, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", outPath]);
    const buffer = await fs.promises.readFile(outPath);
    let seconds = 0;
    try {
      const out = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outPath]);
      seconds = Math.round(parseFloat(out.trim())) || 0;
    } catch {
      /* duration is optional */
    }
    return { buffer, seconds };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
