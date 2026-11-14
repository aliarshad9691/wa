import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { DATA_DIR, makeKv, openDb, type Kv } from "./db";
import { createRepo, formatPhone, type Repo } from "./wa/repo";
import { WhatsAppManager, type WAState } from "./wa/manager";

/**
 * Several WhatsApp numbers under one login. Each account has its own folder with its own database
 * (chats, messages, filtered numbers, alerts and other settings) and WhatsApp session keys:
 *   main      -> DATA_DIR itself (the original single-account layout, unchanged)
 *   <other>   -> DATA_DIR/accounts/<id>/
 * Every account stays connected in the background, so filters and auto-removal keep working for all
 * of them; the browser only chooses which one it is looking at.
 */
export const MAIN_ACCOUNT = "main";
const ID_RE = /^[a-z0-9]{1,32}$/;
const REGISTRY = path.join(DATA_DIR, "accounts.json");

export interface Account {
  id: string;
  dir: string;
  db: Database.Database;
  kv: Kv;
  repo: Repo;
  wa: WhatsAppManager;
}

interface AccountMeta {
  id: string;
  createdAt: number;
}

export interface AccountSummary {
  id: string;
  /** Linked number's name, else its phone number, else "New account". */
  label: string;
  phone: string | null;
  status: WAState["status"];
  unread: number;
}

declare global {
  var __waAccounts: Map<string, Account> | undefined;
}
const loaded: Map<string, Account> = globalThis.__waAccounts ?? (globalThis.__waAccounts = new Map());

export function accountDir(id: string) {
  return id === MAIN_ACCOUNT ? DATA_DIR : path.join(DATA_DIR, "accounts", id);
}

function readRegistry(): AccountMeta[] {
  let list: AccountMeta[] = [];
  try {
    list = (JSON.parse(fs.readFileSync(REGISTRY, "utf8")) as AccountMeta[]).filter((a) => ID_RE.test(a?.id));
  } catch {
    /* first run: only the main account */
  }
  if (!list.some((a) => a.id === MAIN_ACCOUNT)) list.unshift({ id: MAIN_ACCOUNT, createdAt: 0 });
  return list;
}

function writeRegistry(list: AccountMeta[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = REGISTRY + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, REGISTRY);
}

export function accountExists(id: string | null | undefined): id is string {
  return Boolean(id && ID_RE.test(id) && readRegistry().some((a) => a.id === id));
}

/** The account's database and WhatsApp connection, opened on first use. */
export function getAccount(id: string): Account {
  const hit = loaded.get(id);
  if (hit) return hit;
  if (!accountExists(id)) throw new Error(`unknown account: ${id}`);
  const dir = accountDir(id);
  const db = openDb(dir);
  const kv = makeKv(db);
  const repo = createRepo(db, kv);
  const wa = new WhatsAppManager({ id, dir, db, kv, repo });
  const acct: Account = { id, dir, db, kv, repo, wa };
  loaded.set(id, acct);
  return acct;
}

export function listAccounts(): Account[] {
  return readRegistry().map((a) => getAccount(a.id));
}

export function summarize(a: Account): AccountSummary {
  // While disconnected, label the account with the number it was last linked to.
  const me = a.wa.state.me ?? (a.kv.get<string>("meJid") ? { id: a.kv.get<string>("meJid")!, name: a.kv.get<string>("meName") } : null);
  const phone = me?.id ? formatPhone(me.id) : null;
  let unread = 0;
  try {
    unread = a.repo.unreadTotal();
  } catch {
    /* badge only */
  }
  return { id: a.id, label: me?.name || phone || "New account", phone, status: a.wa.state.status, unread };
}

export function createAccount(): Account {
  const list = readRegistry();
  let id: string;
  do id = crypto.randomBytes(5).toString("hex");
  while (list.some((a) => a.id === id));
  writeRegistry([...list, { id, createdAt: Math.floor(Date.now() / 1000) }]);
  return getAccount(id);
}

/**
 * Unlink the phone and take the account off the list. Its folder (messages, settings) is kept,
 * renamed under DATA_DIR/removed-accounts/, in line with the app's "never delete" rule.
 * The main account can't be removed (log it out and link another number instead).
 */
export async function removeAccount(id: string) {
  if (id === MAIN_ACCOUNT) throw new Error("The first account can't be removed. Log it out instead.");
  if (!accountExists(id)) throw new Error("unknown account");
  const a = getAccount(id);
  await a.wa.logout();
  a.wa.bus.removeAllListeners();
  loaded.delete(id);
  try {
    a.db.close();
  } catch {
    /* already closed */
  }
  writeRegistry(readRegistry().filter((m) => m.id !== id));
  const dest = path.join(DATA_DIR, "removed-accounts", `${id}-${Date.now()}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(a.dir, dest);
  } catch (e) {
    console.warn("[accounts] could not move removed account folder", { id, error: (e as Error).message });
  }
}

/** Resume every linked account when the server boots. */
export function bootAccounts() {
  for (const a of listAccounts()) {
    if (a.wa.hasSession() && a.wa.state.status === "disconnected") {
      void a.wa.start().catch((e) => console.error(`[${a.id}] [wa] start failed`, e));
    }
  }
}
