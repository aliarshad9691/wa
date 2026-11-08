import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "ptt"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "poll"
  | "system"
  | "unknown";

export type MediaStatus = "none" | "pending" | "ready" | "failed";

export interface MessageRow {
  chat_id: string;
  id: string;
  from_me: number;
  sender_jid: string | null;
  sender_name: string | null;
  ts: number; // unix seconds
  type: MessageType;
  text: string | null;
  media_key: string | null;
  media_mime: string | null;
  media_size: number | null;
  media_seconds: number | null;
  media_status: MediaStatus;
  media_width: number | null;
  media_height: number | null;
  thumbnail: string | null; // base64 jpeg
  file_name: string | null;
  quoted_id: string | null;
  quoted_text: string | null;
  quoted_sender: string | null;
  status: number; // 0 error, 1 pending, 2 server ack, 3 delivered, 4 read, 5 played
  is_deleted: number;
  deleted_at: number | null;
  is_edited: number;
  edit_history: string | null; // JSON [{text, ts}] of previous versions
  reactions: string | null; // JSON {senderJid: emoji}
  raw: Buffer | null;
  created_at: number;
  removed_from_phone: number; // 1 = auto-deleted from WhatsApp (kept here)
}

export interface ChatRow {
  id: string;
  name: string | null;
  is_group: number;
  unread_count: number;
  last_ts: number;
  archived: number;
  pinned: number;
  muted_until: number;
  avatar_url: string | null;
  avatar_checked_at: number;
}

export interface ContactRow {
  id: string;
  name: string | null;
  notify: string | null;
  verified_name: string | null;
}

declare global {
  var __waDb: Database.Database | undefined;
}

function open(): Database.Database {
  const db = new Database(path.join(DATA_DIR, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_ts INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      muted_until INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT,
      avatar_checked_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS chats_last_ts ON chats(last_ts DESC);

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT,
      notify TEXT,
      verified_name TEXT
    );

    CREATE TABLE IF NOT EXISTS lid_map (
      lid TEXT PRIMARY KEY,
      pn TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      chat_id TEXT NOT NULL,
      id TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      sender_jid TEXT,
      sender_name TEXT,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      text TEXT,
      media_key TEXT,
      media_mime TEXT,
      media_size INTEGER,
      media_seconds INTEGER,
      media_status TEXT NOT NULL DEFAULT 'none',
      media_width INTEGER,
      media_height INTEGER,
      thumbnail TEXT,
      file_name TEXT,
      quoted_id TEXT,
      quoted_text TEXT,
      quoted_sender TEXT,
      status INTEGER NOT NULL DEFAULT 2,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER,
      is_edited INTEGER NOT NULL DEFAULT 0,
      edit_history TEXT,
      reactions TEXT,
      raw BLOB,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chat_id, id)
    );
    CREATE INDEX IF NOT EXISTS messages_chat_ts ON messages(chat_id, ts DESC);
    CREATE INDEX IF NOT EXISTS messages_id ON messages(id);
    CREATE INDEX IF NOT EXISTS messages_media_status ON messages(media_status);

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Numbers whose calls are auto-rejected and whose new messages are archived here,
    -- then deleted (for me) from WhatsApp so they disappear from the phone.
    CREATE TABLE IF NOT EXISTS filtered_numbers (
      pn TEXT PRIMARY KEY,           -- 15551234567@s.whatsapp.net
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      removed_count INTEGER NOT NULL DEFAULT 0,
      calls_rejected INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Lightweight migrations for columns added after first release.
  const cols = new Set((db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("removed_from_phone")) {
    db.exec("ALTER TABLE messages ADD COLUMN removed_from_phone INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}

export const db: Database.Database = globalThis.__waDb ?? (globalThis.__waDb = open());

export function kvGet<T = unknown>(key: string): T | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function kvSet(key: string, value: unknown) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}
