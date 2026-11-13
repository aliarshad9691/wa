import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { getMessage, isHiddenChat, viewExpired } from "@/lib/wa/repo";
import { decodeParam } from "@/lib/params";
import { localMediaPath, signedMediaUrl, usingS3 } from "@/lib/storage";

/** Serves stored media: redirects to a short-lived S3 URL, or streams from local disk in dev. */
export async function GET(req: Request, { params }: { params: Promise<{ chatId: string; msgId: string }> }) {
  const p = await params;
  const { deny } = await requireChat(decodeParam(p.chatId));
  if (deny) return deny;
  const row = getMessage(decodeParam(p.chatId), decodeParam(p.msgId));
  if (row && viewExpired(row) && isHiddenChat(row.chat_id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!row?.media_key || row.media_status !== "ready") {
    return NextResponse.json({ error: "media not available", status: row?.media_status }, { status: 404 });
  }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const mime = row.media_mime?.split(";")[0] || "application/octet-stream";
  const fileName = row.file_name || row.media_key.split("/").pop()!;

  if (usingS3) {
    const url = await signedMediaUrl(row.media_key, { download: download ? fileName : undefined, contentType: mime });
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=600" } });
  }

  const filePath = localMediaPath(row.media_key);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return NextResponse.json({ error: "file missing" }, { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
