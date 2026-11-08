import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { proto, type WAMessage } from "baileys";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";

/**
 * DEV ONLY. Simulates incoming WhatsApp traffic so the UI and archive logic can be exercised
 * without a phone. Disabled when NODE_ENV=production.
 *
 * JSON body:
 *  { action: "text", chat, id?, text, fromMe?, participant?, pushName?, ts?, quotedId? }
 *  { action: "media", chat, id?, kind: "image"|"video"|"audio"|"ptt"|"document", file (name in ./dev-fixtures), mime, caption?, fileName?, seconds? }
 *  { action: "revoke", chat, id, fromMe?, participant? }
 *  { action: "edit", chat, id, text }
 *  { action: "react", chat, id, emoji, participant? }
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const { deny } = await requireUser();
  if (deny) return deny;
  const b = (await req.json()) as Record<string, string | number | boolean | undefined>;
  const chat = String(b.chat);
  const group = chat.endsWith("@g.us");
  const id = String(b.id || "SIM" + Math.random().toString(16).slice(2, 14).toUpperCase());
  const ts = Number(b.ts || Math.floor(Date.now() / 1000));
  const key = {
    remoteJid: chat,
    id,
    fromMe: Boolean(b.fromMe),
    participant: group && !b.fromMe ? String(b.participant || "15550001111@s.whatsapp.net") : undefined,
  };
  const base = { key, messageTimestamp: ts, pushName: b.pushName ? String(b.pushName) : undefined, status: b.fromMe ? 3 : undefined } as WAMessage;
  const ctx = b.quotedId ? { stanzaId: String(b.quotedId), participant: key.participant, quotedMessage: { conversation: String(b.quotedText || "") } } : undefined;

  switch (b.action) {
    case "text":
      wa.devIngest({ ...base, message: { extendedTextMessage: { text: String(b.text), contextInfo: ctx } } });
      break;
    case "media": {
      const buffer = fs.readFileSync(path.join(process.cwd(), "dev-fixtures", path.basename(String(b.file))));
      const mime = String(b.mime);
      const caption = b.caption ? String(b.caption) : undefined;
      const common = { mimetype: mime, fileLength: buffer.length, url: "https://example.invalid/x", mediaKey: new Uint8Array(32) };
      let message: proto.IMessage;
      switch (b.kind) {
        case "image":
          message = { imageMessage: { ...common, caption, width: 640, height: 480 } };
          break;
        case "video":
          message = { videoMessage: { ...common, caption, seconds: Number(b.seconds || 3), width: 640, height: 360 } };
          break;
        case "audio":
        case "ptt":
          message = { audioMessage: { ...common, seconds: Number(b.seconds || 3), ptt: b.kind === "ptt" } };
          break;
        default:
          message = { documentMessage: { ...common, fileName: String(b.fileName || "file.bin"), caption } };
      }
      wa.devIngest({ ...base, message }, { buffer, mime });
      break;
    }
    case "revoke":
      wa.devIngest({
        ...base,
        key: { ...key, id: id + "-revoke" },
        message: { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { ...key } } },
      });
      break;
    case "edit":
      wa.devIngest({
        ...base,
        key: { ...key, id: id + "-edit-" + ts },
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { ...key },
            editedMessage: { conversation: String(b.text) },
          },
        },
      });
      break;
    case "react":
      wa.devIngest({
        ...base,
        key: { ...key, id: id + "-react-" + ts },
        message: { reactionMessage: { key: { ...key }, text: String(b.emoji || "") } },
      });
      break;
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id });
}
