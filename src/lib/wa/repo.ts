import "server-only";
import { jidNormalizedUser, isLidUser, isPnUser, isJidGroup } from "baileys";
import { db, kvGet, kvSet, type ChatRow, type MessageRow } from "../db";
import type { ParsedMessage } from "./parse";

/* ------------------------------------------------------------------ JIDs */

const getLid = db.prepare<[string], { pn: string }>("SELECT pn FROM lid_map WHERE lid = ?");

export function normJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const n = jidNormalizedUser(jid);
  if (isLidUser(n)) {
    const row = getLid.get(n);
    if (row) return row.pn;
  }
  return n;
}

/** Record a LID → phone-number mapping and fold any LID-keyed chat into the PN chat. */
export function learnLid(lid: string | null | undefined, pn: string | null | undefined) {
  if (!lid || !pn) return;
  const l = jidNormalizedUser(lid);
  const p = jidNormalizedUser(pn);
  if (!isLidUser(l) || !isPnUser(p)) return;
  const existing = getLid.get(l);
  if (existing?.pn === p) return;
  db.transaction(() => {
    db.prepare("INSERT INTO lid_map(lid, pn) VALUES(?, ?) ON CONFLICT(lid) DO UPDATE SET pn = excluded.pn").run(l, p);
    const lidChat = db.prepare("SELECT * FROM chats WHERE id = ?").get(l) as ChatRow | undefined;
    if (lidChat) {
      ensureChat(p, { isGroup: false });
      db.prepare(
        `UPDATE chats SET
          name = COALESCE(name, ?),
          unread_count = unread_count + ?,
          last_ts = MAX(last_ts, ?)
         WHERE id = ?`,
      ).run(lidChat.name, lidChat.unread_count, lidChat.last_ts, p);
      db.prepare("UPDATE OR IGNORE messages SET chat_id = ? WHERE chat_id = ?").run(p, l);
      db.prepare("DELETE FROM messages WHERE chat_id = ?").run(l);
      db.prepare("DELETE FROM chats WHERE id = ?").run(l);
    }
    db.prepare("UPDATE messages SET sender_jid = ? WHERE sender_jid = ?").run(p, l);
    const c = db.prepare("SELECT * FROM contacts WHERE id = ?").get(l) as
      | { name: string | null; notify: string | null; verified_name: string | null }
      | undefined;
    if (c) upsertContact({ id: p, name: c.name, notify: c.notify, verifiedName: c.verified_name });
  })();
}

/* ---------------------------------------------------------------- chats */

export function ensureChat(id: string, opts: { isGroup?: boolean } = {}) {
  db.prepare("INSERT OR IGNORE INTO chats(id, is_group) VALUES(?, ?)").run(id, opts.isGroup ?? (isJidGroup(id) ? 1 : 0));
}

export function upsertChatMeta(
  id: string,
  meta: {
    name?: string | null;
    unread?: number | null;
    lastTs?: number | null;
    archived?: boolean | null;
    pinned?: number | null;
    mutedUntil?: number | null;
  },
) {
  ensureChat(id);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (meta.name) {
    sets.push("name = ?");
    vals.push(meta.name);
  }
  if (meta.unread != null && meta.unread >= 0) {
    sets.push("unread_count = ?");
    vals.push(meta.unread);
  }
  if (meta.lastTs) {
    sets.push("last_ts = MAX(last_ts, ?)");
    vals.push(meta.lastTs);
  }
  if (meta.archived != null) {
    sets.push("archived = ?");
    vals.push(meta.archived ? 1 : 0);
  }
  if (meta.pinned != null) {
    sets.push("pinned = ?");
    vals.push(meta.pinned);
  }
  if (meta.mutedUntil != null) {
    sets.push("muted_until = ?");
    vals.push(meta.mutedUntil);
  }
  if (!sets.length) return;
  db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function upsertContact(c: { id: string; name?: string | null; notify?: string | null; verifiedName?: string | null }) {
  db.prepare(
    `INSERT INTO contacts(id, name, notify, verified_name) VALUES(?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(excluded.name, contacts.name),
       notify = COALESCE(excluded.notify, contacts.notify),
       verified_name = COALESCE(excluded.verified_name, contacts.verified_name)`,
  ).run(c.id, c.name || null, c.notify || null, c.verifiedName || null);
}

export function formatPhone(jid: string) {
  const user = jid.split("@")[0].split(":")[0];
  return /^\d+$/.test(user) ? "+" + user : user;
}

const contactName = db.prepare<[string], { name: string | null; notify: string | null; verified_name: string | null }>(
  "SELECT name, notify, verified_name FROM contacts WHERE id = ?",
);

export function displayName(jid: string | null | undefined, fallback?: string | null): string {
  if (!jid) return fallback || "Unknown";
  const c = contactName.get(jid);
  return c?.name || c?.notify || c?.verified_name || fallback || formatPhone(jid);
}

export interface ChatListItem {
  id: string;
  name: string;
  isGroup: boolean;
  unread: number;
  lastTs: number;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  last: {
    id: string;
    fromMe: boolean;
    type: string;
    text: string | null;
    status: number;
    isDeleted: boolean;
    senderName: string | null;
  } | null;
}

/** Chat ids of filtered numbers (phone JIDs and any LIDs mapped to them). These chats are hidden. */
const HIDDEN_SQL = `SELECT pn FROM filtered_numbers UNION SELECT l.lid FROM lid_map l JOIN filtered_numbers f ON f.pn = l.pn`;

/**
 * Chats for the sidebar. Filtered numbers' chats are left out, unless `hidden` is true, which
 * returns only those (shown when the secret search code is typed).
 */
export function listChats(opts: { hidden?: boolean } = {}): ChatListItem[] {
  const rows = db
    .prepare(
      `SELECT c.*, m.id AS m_id, m.from_me AS m_from_me, m.type AS m_type, m.text AS m_text, m.status AS m_status,
              m.is_deleted AS m_deleted, m.sender_jid AS m_sender, m.sender_name AS m_sender_name, m.file_name AS m_file
       FROM chats c
       LEFT JOIN messages m ON m.rowid = (
         SELECT rowid FROM messages WHERE chat_id = c.id AND type != 'system' ORDER BY ts DESC LIMIT 1
       )
       WHERE c.id NOT LIKE '%@broadcast' AND c.id NOT LIKE '%@newsletter'
         AND c.id ${opts.hidden ? "IN" : "NOT IN"} (${HIDDEN_SQL})
       ORDER BY c.pinned DESC, c.last_ts DESC`,
    )
    .all() as (ChatRow & {
    m_id: string | null;
    m_from_me: number;
    m_type: string;
    m_text: string | null;
    m_status: number;
    m_deleted: number;
    m_sender: string | null;
    m_sender_name: string | null;
    m_file: string | null;
  })[];
  const now = Math.floor(Date.now() / 1000);
  return rows
    .filter((r) => r.m_id || r.name)
    .map((r) => ({
      id: r.id,
      name: r.is_group ? r.name || "Group" : displayName(r.id, r.name),
      isGroup: !!r.is_group,
      unread: r.unread_count,
      lastTs: r.last_ts,
      archived: !!r.archived,
      pinned: !!r.pinned,
      muted: r.muted_until === -1 || r.muted_until > now,
      last: r.m_id
        ? {
            id: r.m_id,
            fromMe: !!r.m_from_me,
            type: r.m_type,
            text: r.m_text || r.m_file,
            status: r.m_status,
            isDeleted: !!r.m_deleted,
            senderName: r.m_from_me ? null : r.m_sender ? displayName(r.m_sender, r.m_sender_name) : null,
          }
        : null,
    }));
}

export function getChat(id: string) {
  return db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as ChatRow | undefined;
}

/* ------------------------------------------------------------- messages */

export interface MessageDTO {
  id: string;
  chatId: string;
  fromMe: boolean;
  senderJid: string | null;
  senderName: string | null;
  ts: number;
  type: string;
  text: string | null;
  media: null | {
    status: string;
    mime: string | null;
    size: number | null;
    seconds: number | null;
    width: number | null;
    height: number | null;
    fileName: string | null;
    thumbnail: string | null;
  };
  quoted: null | { id: string; text: string | null; sender: string | null };
  status: number;
  isDeleted: boolean;
  deletedAt: number | null;
  isEdited: boolean;
  removedFromPhone: boolean;
  editHistory: { text: string | null; ts: number }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
}

export function toDTO(r: MessageRow): MessageDTO {
  const reactionsMap: Record<string, string> = r.reactions ? JSON.parse(r.reactions) : {};
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const [sender, emoji] of Object.entries(reactionsMap)) {
    if (!emoji) continue;
    const e = counts.get(emoji) || { count: 0, mine: false };
    e.count++;
    if (sender === "me") e.mine = true;
    counts.set(emoji, e);
  }
  return {
    id: r.id,
    chatId: r.chat_id,
    fromMe: !!r.from_me,
    senderJid: r.sender_jid,
    senderName: r.from_me ? "You" : r.sender_jid ? displayName(r.sender_jid, r.sender_name) : null,
    ts: r.ts,
    type: r.type,
    text: r.text,
    media:
      r.media_status !== "none" || r.media_mime
        ? {
            status: r.media_status,
            mime: r.media_mime,
            size: r.media_size,
            seconds: r.media_seconds,
            width: r.media_width,
            height: r.media_height,
            fileName: r.file_name,
            thumbnail: r.thumbnail,
          }
        : null,
    quoted: r.quoted_id ? { id: r.quoted_id, text: r.quoted_text, sender: quotedSender(r) } : null,
    status: r.status,
    isDeleted: !!r.is_deleted,
    deletedAt: r.deleted_at,
    isEdited: !!r.is_edited,
    removedFromPhone: !!r.removed_from_phone,
    editHistory: r.edit_history ? JSON.parse(r.edit_history) : [],
    reactions: [...counts.entries()].map(([emoji, v]) => ({ emoji, ...v })),
  };
}

const quotedLookup = db.prepare<[string, string], { from_me: number; sender_jid: string | null; sender_name: string | null }>(
  "SELECT from_me, sender_jid, sender_name FROM messages WHERE chat_id = ? AND id = ?",
);

function quotedSender(r: MessageRow): string {
  const q = quotedLookup.get(r.chat_id, r.quoted_id!);
  if (q) return q.from_me ? "You" : displayName(q.sender_jid || r.chat_id, q.sender_name);
  const jid = normJid(r.quoted_sender);
  const me = kvGet<string>("meJid");
  if (jid && me && jid === me) return "You";
  return displayName(jid || r.chat_id);
}

const COLS = `chat_id, id, from_me, sender_jid, sender_name, ts, type, text, media_key, media_mime, media_size,
  media_seconds, media_status, media_width, media_height, thumbnail, file_name, quoted_id, quoted_text,
  quoted_sender, status, is_deleted, deleted_at, is_edited, edit_history, reactions, raw, created_at, removed_from_phone`;

export function listMessages(
  chatId: string,
  opts: { before?: number; after?: number; limit?: number; onlyDeleted?: boolean } = {},
) {
  const limit = Math.min(opts.limit || 50, 200);
  const where = ["chat_id = ?"];
  const args: unknown[] = [chatId];
  if (opts.before) {
    where.push("ts < ?");
    args.push(opts.before);
  }
  if (opts.after) {
    where.push("ts > ?");
    args.push(opts.after);
  }
  if (opts.onlyDeleted) where.push("is_deleted = 1");
  const asc = Boolean(opts.after && !opts.before);
  const rows = db
    .prepare(
      `SELECT ${COLS} FROM messages WHERE ${where.join(" AND ")}
       ORDER BY ts ${asc ? "ASC" : "DESC"}, rowid ${asc ? "ASC" : "DESC"} LIMIT ?`,
    )
    .all(...args, limit) as MessageRow[];
  return (asc ? rows : rows.reverse()).map(toDTO);
}

export function getMessage(chatId: string, id: string) {
  return db.prepare(`SELECT ${COLS} FROM messages WHERE chat_id = ? AND id = ?`).get(chatId, id) as MessageRow | undefined;
}

export function findMessageById(id: string) {
  return db.prepare(`SELECT ${COLS} FROM messages WHERE id = ? LIMIT 1`).get(id) as MessageRow | undefined;
}

export function listDeleted(limit = 200) {
  return (
    db.prepare(`SELECT ${COLS} FROM messages WHERE is_deleted = 1 AND chat_id NOT IN (${HIDDEN_SQL}) ORDER BY deleted_at DESC LIMIT ?`).all(limit) as MessageRow[]
  ).map(toDTO);
}

export function searchMessages(q: string, limit = 50) {
  return (
    db
      .prepare(
        `SELECT ${COLS} FROM messages WHERE text LIKE ? ESCAPE '\\' AND type != 'system' AND chat_id NOT IN (${HIDDEN_SQL})
         ORDER BY ts DESC LIMIT ?`,
      )
      .all(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`, limit) as MessageRow[]
  ).map(toDTO);
}

/**
 * Insert or merge a parsed message. Returns the stored row and whether it is new.
 * Never clears content of a message that was deleted on WhatsApp.
 */
export function upsertMessage(
  chatId: string,
  p: ParsedMessage,
  extra: { senderName?: string | null; raw?: Buffer | null; revokedStub?: boolean },
): { row: MessageRow; isNew: boolean } {
  const existing = getMessage(chatId, p.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO messages(chat_id, id, from_me, sender_jid, sender_name, ts, type, text, media_mime, media_size,
        media_seconds, media_status, media_width, media_height, thumbnail, file_name, quoted_id, quoted_text,
        quoted_sender, status, is_deleted, deleted_at, raw)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      chatId,
      p.id,
      p.from_me,
      p.sender_jid,
      extra.senderName || null,
      p.ts,
      p.type,
      p.text,
      p.media_mime,
      p.media_size,
      p.media_seconds,
      p.hasMedia ? "pending" : "none",
      p.media_width,
      p.media_height,
      p.thumbnail,
      p.file_name,
      p.quoted_id,
      p.quoted_text,
      p.quoted_sender,
      p.status,
      extra.revokedStub ? 1 : 0,
      extra.revokedStub ? p.ts : null,
      extra.raw || null,
    );
    return { row: getMessage(chatId, p.id)!, isNew: true };
  }

  // Merge: a later copy (e.g. after decryption retry) may have content the first did not.
  const hadContent = existing.type !== "system" || existing.text;
  if (extra.revokedStub) {
    // We already have the content; just flag it.
    if (!existing.is_deleted) {
      db.prepare("UPDATE messages SET is_deleted = 1, deleted_at = ? WHERE chat_id = ? AND id = ?").run(p.ts, chatId, p.id);
    }
  } else if (!hadContent || (existing.type === "system" && p.type !== "system") || (existing.text == null && p.text && existing.type === "text")) {
    db.prepare(
      `UPDATE messages SET type = ?, text = COALESCE(?, text), media_mime = ?, media_size = ?, media_seconds = ?,
         media_status = CASE WHEN media_status IN ('ready') THEN media_status ELSE ? END,
         media_width = ?, media_height = ?, thumbnail = ?, file_name = ?, quoted_id = ?, quoted_text = ?, quoted_sender = ?,
         raw = COALESCE(?, raw)
       WHERE chat_id = ? AND id = ?`,
    ).run(
      p.type,
      p.text,
      p.media_mime,
      p.media_size,
      p.media_seconds,
      p.hasMedia ? "pending" : "none",
      p.media_width,
      p.media_height,
      p.thumbnail,
      p.file_name,
      p.quoted_id,
      p.quoted_text,
      p.quoted_sender,
      extra.raw || null,
      chatId,
      p.id,
    );
  } else if (extra.raw && !existing.raw) {
    db.prepare("UPDATE messages SET raw = ? WHERE chat_id = ? AND id = ?").run(extra.raw, chatId, p.id);
  }
  if (p.status > existing.status) {
    db.prepare("UPDATE messages SET status = ? WHERE chat_id = ? AND id = ?").run(p.status, chatId, p.id);
  }
  return { row: getMessage(chatId, p.id)!, isNew: false };
}

export function markDeleted(chatId: string | null, id: string, ts: number, placeholder?: Partial<ParsedMessage>) {
  const target = chatId ? getMessage(chatId, id) : findMessageById(id);
  if (target) {
    if (!target.is_deleted) {
      db.prepare("UPDATE messages SET is_deleted = 1, deleted_at = ? WHERE chat_id = ? AND id = ?").run(
        ts,
        target.chat_id,
        id,
      );
    }
    return getMessage(target.chat_id, id)!;
  }
  if (!chatId) return null;
  // We never saw the original — keep a placeholder so the deletion is still visible.
  ensureChat(chatId);
  db.prepare(
    `INSERT OR IGNORE INTO messages(chat_id, id, from_me, sender_jid, ts, type, text, is_deleted, deleted_at, status)
     VALUES(?, ?, ?, ?, ?, 'text', NULL, 1, ?, 2)`,
  ).run(chatId, id, placeholder?.from_me ?? 0, placeholder?.sender_jid ?? null, placeholder?.ts ?? ts, ts);
  return getMessage(chatId, id) || null;
}

export function applyEdit(chatId: string | null, id: string, newText: string | null, ts: number) {
  const target = chatId ? getMessage(chatId, id) : findMessageById(id);
  if (!target) return null;
  if (newText == null || newText === target.text) return target;
  const history: { text: string | null; ts: number }[] = target.edit_history ? JSON.parse(target.edit_history) : [];
  history.push({ text: target.text, ts });
  db.prepare("UPDATE messages SET text = ?, is_edited = 1, edit_history = ? WHERE chat_id = ? AND id = ?").run(
    newText,
    JSON.stringify(history),
    target.chat_id,
    id,
  );
  return getMessage(target.chat_id, id)!;
}

export function applyReaction(chatId: string | null, id: string, sender: string, emoji: string) {
  const target = chatId ? getMessage(chatId, id) : findMessageById(id);
  if (!target) return null;
  const map: Record<string, string> = target.reactions ? JSON.parse(target.reactions) : {};
  if (emoji) map[sender] = emoji;
  else delete map[sender];
  db.prepare("UPDATE messages SET reactions = ? WHERE chat_id = ? AND id = ?").run(JSON.stringify(map), target.chat_id, id);
  return getMessage(target.chat_id, id)!;
}

export function setStatus(chatId: string, id: string, status: number) {
  const r = db
    .prepare("UPDATE messages SET status = ? WHERE chat_id = ? AND id = ? AND status < ?")
    .run(status, chatId, id, status);
  return r.changes ? getMessage(chatId, id)! : null;
}

export function setMedia(chatId: string, id: string, fields: { status: string; key?: string | null; mime?: string | null; size?: number | null }) {
  db.prepare(
    `UPDATE messages SET media_status = ?, media_key = COALESCE(?, media_key), media_mime = COALESCE(?, media_mime),
       media_size = COALESCE(?, media_size) WHERE chat_id = ? AND id = ?`,
  ).run(fields.status, fields.key ?? null, fields.mime ?? null, fields.size ?? null, chatId, id);
  return getMessage(chatId, id);
}

export function pendingMedia(limit: number) {
  return db
    .prepare(
      `SELECT chat_id, id FROM messages WHERE media_status = 'pending' AND raw IS NOT NULL ORDER BY ts DESC LIMIT ?`,
    )
    .all(limit) as { chat_id: string; id: string }[];
}

export function touchChat(chatId: string, ts: number, incrementUnread: boolean) {
  ensureChat(chatId);
  db.prepare(
    `UPDATE chats SET last_ts = MAX(last_ts, ?), unread_count = unread_count + ? WHERE id = ?`,
  ).run(ts, incrementUnread ? 1 : 0, chatId);
}


/* ------------------------------------------------------- filtered numbers */

export interface FilteredNumber {
  pn: string;
  label: string | null;
  created_at: number;
  removed_count: number;
  calls_rejected: number;
}

/** "+971 50 123 4567" / "00971501234567" -> "971501234567@s.whatsapp.net" (or null if not a plausible number). */
export function phoneToJid(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return `${digits}@s.whatsapp.net`;
}

export function listFiltered(): FilteredNumber[] {
  return db.prepare("SELECT * FROM filtered_numbers ORDER BY created_at DESC").all() as FilteredNumber[];
}

export function addFiltered(pn: string, label: string | null) {
  db.prepare(
    "INSERT INTO filtered_numbers(pn, label) VALUES(?, ?) ON CONFLICT(pn) DO UPDATE SET label = COALESCE(excluded.label, filtered_numbers.label)",
  ).run(pn, label);
}

export function removeFiltered(pn: string) {
  db.prepare("DELETE FROM filtered_numbers WHERE pn = ?").run(pn);
}

export function bumpFiltered(pn: string, field: "removed_count" | "calls_rejected") {
  db.prepare(`UPDATE filtered_numbers SET ${field} = ${field} + 1 WHERE pn = ?`).run(pn);
}

export function markRemovedFromPhone(chatId: string, id: string) {
  db.prepare("UPDATE messages SET removed_from_phone = 1 WHERE chat_id = ? AND id = ?").run(chatId, id);
  return getMessage(chatId, id);
}

/** A system line in the chat, e.g. "Call rejected automatically". */
export function insertSystemMessage(chatId: string, id: string, ts: number, text: string) {
  ensureChat(chatId);
  db.prepare(
    `INSERT OR IGNORE INTO messages(chat_id, id, from_me, ts, type, text, status) VALUES(?, ?, 0, ?, 'system', ?, 2)`,
  ).run(chatId, id, ts, text);
  return getMessage(chatId, id);
}

/* ------------------------------------------------------------ alerts */

/** WhatsApp message sent to an alert number when a filtered (hidden) number messages me. */
export interface AlertSettings {
  /** Phone-number JID to alert, or null when alerts are off. */
  phone: string | null;
  /** Generic one-liner; never includes the received message. */
  text: string;
  /** Minimum minutes between alerts, so a burst of messages sends one alert. 0 = every message. */
  cooldownMin: number;
}

export const DEFAULT_ALERT_TEXT = "You have a new message waiting in Chat Mirror.";

export function getAlertSettings(): AlertSettings {
  const s = kvGet<Partial<AlertSettings>>("alertSettings") || {};
  return {
    phone: s.phone || null,
    text: s.text?.trim() || DEFAULT_ALERT_TEXT,
    cooldownMin: typeof s.cooldownMin === "number" ? s.cooldownMin : 5,
  };
}

export function setAlertSettings(s: AlertSettings) {
  kvSet("alertSettings", s);
}
