import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { decodeParam } from "@/lib/params";
import { toVoiceNote } from "@/lib/audio";

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * multipart/form-data:
 *   text      – message text, or caption when a file is attached
 *   file      – optional attachment
 *   mode      – "media" (photo/video/audio as-is) | "document" | "voice"
 *   quotedId  – optional id of the message being replied to
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const chatId = decodeParam((await params).id);
  try {
    const form = await req.formData();
    const text = String(form.get("text") || "").trim();
    const mode = String(form.get("mode") || "media");
    const quotedId = String(form.get("quotedId") || "") || undefined;
    const file = form.get("file");

    if (file && typeof file !== "string") {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 100 MB)" }, { status: 413 });
      let buffer: Buffer = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "application/octet-stream";
      if (mode === "voice") {
        const v = await toVoiceNote(buffer);
        buffer = v.buffer;
        const id = await wa.sendMedia(chatId, { buffer, mime: "audio/ogg", name: "voice.ogg" }, { voice: { seconds: v.seconds }, quotedId });
        return NextResponse.json({ id });
      }
      const id = await wa.sendMedia(
        chatId,
        { buffer, mime, name: file.name || "file" },
        { caption: text || undefined, asDocument: mode === "document", quotedId },
      );
      return NextResponse.json({ id });
    }

    if (!text) return NextResponse.json({ error: "Nothing to send" }, { status: 400 });
    const id = await wa.sendText(chatId, text, quotedId);
    return NextResponse.json({ id });
  } catch (e) {
    console.error("[send]", e);
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg.includes("not connected") ? 503 : 500 });
  }
}
