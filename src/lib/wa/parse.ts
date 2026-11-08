import "server-only";
import { proto, normalizeMessageContent, getContentType, type WAMessage } from "baileys";
import type { MessageRow, MessageType } from "../db";

export type ParsedMessage = Omit<
  MessageRow,
  "chat_id" | "media_key" | "media_status" | "is_deleted" | "deleted_at" | "is_edited" | "edit_history" | "reactions" | "created_at" | "raw" | "sender_name" | "removed_from_phone"
> & {
  hasMedia: boolean;
  /** protocol / control messages that should not be shown as bubbles */
  control?:
    | { kind: "revoke"; targetId: string }
    | { kind: "edit"; targetId: string; text: string | null }
    | { kind: "reaction"; targetId: string; emoji: string }
    | { kind: "ignore" };
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && v !== null && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  return Number(v) || 0;
}

function b64(v: Uint8Array | null | undefined): string | null {
  if (!v || !v.length) return null;
  return Buffer.from(v).toString("base64");
}

function contextOf(content: proto.IMessage, type: string): proto.IContextInfo | null | undefined {
  const inner = (content as Record<string, unknown>)[type] as { contextInfo?: proto.IContextInfo } | undefined;
  return inner && typeof inner === "object" ? inner.contextInfo : undefined;
}

export function textOf(content: proto.IMessage | null | undefined): string | null {
  if (!content) return null;
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    null
  );
}

/** Convert a raw WAMessage into a DB-ready shape (excluding chat id + persistence fields). */
export function parseMessage(msg: WAMessage): ParsedMessage | null {
  const key = msg.key;
  if (!key?.id) return null;

  const base = {
    id: key.id,
    from_me: key.fromMe ? 1 : 0,
    sender_jid: key.fromMe ? null : key.participant || key.remoteJid || null,
    ts: toNum(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
    text: null as string | null,
    media_mime: null as string | null,
    media_size: null as number | null,
    media_seconds: null as number | null,
    media_width: null as number | null,
    media_height: null as number | null,
    thumbnail: null as string | null,
    file_name: null as string | null,
    quoted_id: null as string | null,
    quoted_text: null as string | null,
    quoted_sender: null as string | null,
    status: typeof msg.status === "number" ? msg.status : key.fromMe ? 2 : 0,
    hasMedia: false,
  };

  // Messages revoked before they reached us (e.g. during history sync) only carry a stub.
  if (msg.messageStubType === proto.WebMessageInfo.StubType.REVOKE && !msg.message) {
    return { ...base, type: "text", text: null, control: undefined };
  }

  const content = normalizeMessageContent(msg.message);
  if (!content) {
    if (msg.messageStubType) {
      return { ...base, type: "system", text: stubText(msg), control: undefined };
    }
    return null;
  }

  if (content.protocolMessage) {
    const pm = content.protocolMessage;
    if (pm.type === proto.Message.ProtocolMessage.Type.REVOKE && pm.key?.id) {
      return { ...base, type: "system", control: { kind: "revoke", targetId: pm.key.id } };
    }
    if (pm.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && pm.key?.id) {
      return {
        ...base,
        type: "system",
        control: { kind: "edit", targetId: pm.key.id, text: textOf(normalizeMessageContent(pm.editedMessage)) },
      };
    }
    return { ...base, type: "system", control: { kind: "ignore" } };
  }
  if (content.reactionMessage) {
    const r = content.reactionMessage;
    return {
      ...base,
      type: "system",
      control: { kind: "reaction", targetId: r.key?.id || "", emoji: r.text || "" },
    };
  }
  if (content.senderKeyDistributionMessage && Object.keys(content).length === 1) {
    return { ...base, type: "system", control: { kind: "ignore" } };
  }

  const ctype = getContentType(content);
  if (!ctype) return null;
  if (
    ctype === "senderKeyDistributionMessage" ||
    ctype === "messageContextInfo" ||
    ctype === "pollUpdateMessage" ||
    ctype === "keepInChatMessage" ||
    ctype === "encReactionMessage"
  ) {
    return { ...base, type: "system", control: { kind: "ignore" } };
  }

  let type: MessageType = "unknown";
  const out = { ...base };

  switch (ctype) {
    case "conversation":
    case "extendedTextMessage":
      type = "text";
      out.text = textOf(content);
      break;
    case "imageMessage": {
      const m = content.imageMessage!;
      type = "image";
      out.text = m.caption || null;
      out.media_mime = m.mimetype || "image/jpeg";
      out.media_size = toNum(m.fileLength) || null;
      out.media_width = m.width || null;
      out.media_height = m.height || null;
      out.thumbnail = b64(m.jpegThumbnail);
      out.hasMedia = true;
      break;
    }
    case "videoMessage":
    case "ptvMessage": {
      const m = (content.videoMessage || content.ptvMessage)!;
      type = "video";
      out.text = m.caption || null;
      out.media_mime = m.mimetype || "video/mp4";
      out.media_size = toNum(m.fileLength) || null;
      out.media_seconds = m.seconds || null;
      out.media_width = m.width || null;
      out.media_height = m.height || null;
      out.thumbnail = b64(m.jpegThumbnail);
      out.hasMedia = true;
      break;
    }
    case "audioMessage": {
      const m = content.audioMessage!;
      type = m.ptt ? "ptt" : "audio";
      out.media_mime = m.mimetype || "audio/ogg";
      out.media_size = toNum(m.fileLength) || null;
      out.media_seconds = m.seconds || null;
      out.hasMedia = true;
      break;
    }
    case "documentMessage":
    case "documentWithCaptionMessage": {
      const m = content.documentMessage || content.documentWithCaptionMessage?.message?.documentMessage;
      if (!m) break;
      type = "document";
      out.text = m.caption || null;
      out.file_name = m.fileName || m.title || "document";
      out.media_mime = m.mimetype || "application/octet-stream";
      out.media_size = toNum(m.fileLength) || null;
      out.thumbnail = b64(m.jpegThumbnail);
      out.hasMedia = true;
      break;
    }
    case "stickerMessage": {
      const m = content.stickerMessage!;
      type = "sticker";
      out.media_mime = m.mimetype || "image/webp";
      out.media_size = toNum(m.fileLength) || null;
      out.media_width = m.width || null;
      out.media_height = m.height || null;
      out.hasMedia = true;
      break;
    }
    case "locationMessage":
    case "liveLocationMessage": {
      const m = (content.locationMessage || content.liveLocationMessage)!;
      type = "location";
      const name = (m as proto.Message.ILocationMessage).name;
      out.text = `${name ? name + "\n" : ""}https://maps.google.com/?q=${m.degreesLatitude},${m.degreesLongitude}`;
      out.thumbnail = b64(m.jpegThumbnail);
      break;
    }
    case "contactMessage":
      type = "contact";
      out.text = content.contactMessage?.displayName || "Contact";
      break;
    case "contactsArrayMessage":
      type = "contact";
      out.text = (content.contactsArrayMessage?.contacts || []).map((c) => c.displayName).join(", ") || "Contacts";
      break;
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3": {
      const m = content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3;
      type = "poll";
      out.text = `📊 ${m?.name || "Poll"}\n` + (m?.options || []).map((o) => `• ${o.optionName}`).join("\n");
      break;
    }
    default:
      type = "unknown";
      out.text = textOf(content);
  }

  const ctx = contextOf(content, ctype);
  if (ctx?.stanzaId) {
    out.quoted_id = ctx.stanzaId;
    out.quoted_sender = ctx.participant || null;
    const q = normalizeMessageContent(ctx.quotedMessage);
    out.quoted_text = textOf(q) || (q ? describeMedia(getContentType(q)) : null);
  }

  return { ...out, type };
}

function describeMedia(ctype: string | undefined): string | null {
  switch (ctype) {
    case "imageMessage":
      return "📷 Photo";
    case "videoMessage":
      return "🎥 Video";
    case "audioMessage":
      return "🎤 Audio";
    case "documentMessage":
      return "📄 Document";
    case "stickerMessage":
      return "Sticker";
    default:
      return null;
  }
}

function stubText(msg: WAMessage): string {
  const T = proto.WebMessageInfo.StubType;
  const params = msg.messageStubParameters || [];
  switch (msg.messageStubType) {
    case T.GROUP_CREATE:
      return `Group created${params[0] ? `: ${params[0]}` : ""}`;
    case T.GROUP_CHANGE_SUBJECT:
      return `Group name changed to "${params[0] || ""}"`;
    case T.GROUP_PARTICIPANT_ADD:
      return "Participant added";
    case T.GROUP_PARTICIPANT_REMOVE:
      return "Participant removed";
    case T.GROUP_PARTICIPANT_LEAVE:
      return "Participant left";
    case T.CIPHERTEXT:
      return "⏳ Waiting for this message. This may take a while.";
    case T.E2E_ENCRYPTED:
      return "Messages are end-to-end encrypted";
    default:
      return T[msg.messageStubType as number]?.toString().toLowerCase().replace(/_/g, " ") || "System message";
  }
}
