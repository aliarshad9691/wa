import "server-only";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState as multiFileAuthState,
  type AnyMessageContent,
  type WAMessage,
  type WASocket,
} from "baileys";
import { DATA_DIR, db, kvGet, kvSet, type MessageRow } from "../db";
import { extFromMime, putMedia } from "../storage";
import { parseMessage } from "./parse";
import * as repo from "./repo";

export type WAStatus = "disconnected" | "connecting" | "qr" | "open";

export interface WAState {
  status: WAStatus;
  qr: string | null; // data URL
  pairingCode: string | null;
  me: { id: string; name: string | null } | null;
  lastError: string | null;
  sync: { active: boolean; progress: number | null; chats: number; messages: number; lastAt: number | null };
  media: { queued: number; active: number; failed: number };
}

export type WAEvent =
  | { type: "state"; state: WAState }
  | { type: "message"; chatId: string; messageId: string; isNew: boolean }
  | { type: "chats" }
  | { type: "history"; chatIds: string[] };

const AUTH_DIR = path.join(DATA_DIR, "wa-auth");

/** Baileys' media download has no timeout; a stalled CDN connection would hold a queue slot forever. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`media download timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 2 minutes, plus a minute per 20 MB for large files. */
function downloadTimeoutMs(size: number | null) {
  return 120_000 + Math.ceil((size || 0) / (20 * 1024 * 1024)) * 60_000;
}
/**
 * Media older than this many days is not downloaded automatically (status "skipped"); it can still
 * be fetched on demand from the chat. 0 downloads everything.
 */
const MEDIA_AUTO_DAYS = Number(process.env.MEDIA_AUTO_DAYS ?? 30);
function mediaCutoffTs() {
  return MEDIA_AUTO_DAYS > 0 ? Math.floor(Date.now() / 1000) - MEDIA_AUTO_DAYS * 86400 : 0;
}
/** Pull the phone's entire history on link. Off by default: the phone then sends only recent chats. */
const SYNC_FULL_HISTORY = process.env.SYNC_FULL_HISTORY === "1";

const logger = pino({ level: process.env.WA_LOG_LEVEL || "warn" });

class WhatsAppManager {
  sock: WASocket | null = null;
  bus = new EventEmitter();
  state: WAState = {
    status: "disconnected",
    qr: null,
    pairingCode: null,
    me: null,
    lastError: null,
    sync: { active: false, progress: null, chats: 0, messages: 0, lastAt: kvGet<number>("lastSyncAt") },
    media: { queued: 0, active: 0, failed: 0 },
  };
  private starting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private retries = 0;
  private generation = 0;
  private chatsDirty = false;
  private chatsTimer: NodeJS.Timeout | null = null;
  private outgoingMedia = new Map<string, { buffer: Buffer; mime: string }>();
  private storingOwn = new Set<string>();
  private mediaQueue: { chatId: string; id: string }[] = [];
  private mediaQueued = new Set<string>();
  private mediaActive = 0;
  private wantPairingFor: string | null = null;
  /** Filtered phone-number JID -> when it was added (unix seconds). Only later messages are removed. */
  private filtered = new Map<string, number>(repo.listFiltered().map((f) => [f.pn, f.created_at]));
  private autoRemoved = new Set<string>();
  /** Ids of messages sent from this app (not the phone); only these of my own messages are auto-removed. */
  private sentHere = new Set<string>();
  private lastAlertAt = 0;
  private rejectedCalls = new Set<string>();

  constructor() {
    this.bus.setMaxListeners(100);
  }

  hasSession() {
    return fs.existsSync(path.join(AUTH_DIR, "creds.json"));
  }

  private setState(patch: Partial<WAState>) {
    this.state = { ...this.state, ...patch };
    this.bus.emit("event", { type: "state", state: this.state } satisfies WAEvent);
  }

  private emitMessage(chatId: string, messageId: string, isNew: boolean) {
    this.bus.emit("event", { type: "message", chatId, messageId, isNew } satisfies WAEvent);
    this.markChatsDirty();
  }

  private markChatsDirty() {
    this.chatsDirty = true;
    if (this.chatsTimer) return;
    this.chatsTimer = setTimeout(() => {
      this.chatsTimer = null;
      if (this.chatsDirty) {
        this.chatsDirty = false;
        this.bus.emit("event", { type: "chats" } satisfies WAEvent);
      }
    }, 400);
  }

  /** Start (or resume) the WhatsApp connection. Safe to call repeatedly. */
  start(opts: { pairingPhone?: string } = {}): Promise<void> {
    if (opts.pairingPhone) this.wantPairingFor = opts.pairingPhone.replace(/\D/g, "");
    if (this.sock && this.state.status !== "disconnected") {
      if (this.wantPairingFor && this.state.status === "qr") void this.requestPairing();
      return Promise.resolve();
    }
    if (this.starting) return this.starting;
    this.starting = this.connect().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async connect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const gen = ++this.generation;
    this.setState({ status: "connecting", qr: null, pairingCode: null, lastError: null });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await multiFileAuthState(AUTH_DIR);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      /* use the bundled default */
    }

    // WhatsApp currently rejects the "Desktop" companion identity (HTTP 428), so we link as a browser.
    // Older history can be pulled on demand from a chat ("Load older messages from phone").
    const browserName = process.env.WA_BROWSER || "Chrome";
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      logger,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: Browsers.macOS(browserName),
      syncFullHistory: SYNC_FULL_HISTORY,
      markOnlineOnConnect: false,
      ...(SYNC_FULL_HISTORY ? { shouldSyncHistoryMessage: () => true } : {}),
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        const row = key.id ? repo.findMessageById(key.id) : undefined;
        if (!row?.raw) return undefined;
        try {
          return proto.WebMessageInfo.decode(row.raw).message || undefined;
        } catch {
          return undefined;
        }
      },
    });
    this.sock = sock;
    const alive = () => gen === this.generation;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (!alive()) return;
      if (u.qr) {
        const qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
        this.setState({ status: "qr", qr });
        if (this.wantPairingFor) void this.requestPairing();
      }
      if (u.connection === "open") {
        this.retries = 0;
        this.wantPairingFor = null;
        const me = sock.user ? { id: jidNormalizedUser(sock.user.id), name: sock.user.name || null } : null;
        if (me) kvSet("meJid", me.id);
        this.setState({ status: "open", qr: null, pairingCode: null, me, lastError: null });
        void this.afterOpen(sock);
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const msg = u.lastDisconnect?.error?.message || null;
        this.sock = null;
        if (code === DisconnectReason.loggedOut) {
          await this.wipeAuth();
          this.setState({ status: "disconnected", qr: null, me: null, lastError: "Logged out from phone" });
          return;
        }
        // `creds.registered` stays false after QR pairing; `creds.me` is set once a phone is linked.
        const paired = Boolean(state.creds.me?.id);
        if (!paired && code === DisconnectReason.timedOut) {
          // QR expired without a scan — don't loop forever; the settings page restarts it.
          this.setState({ status: "disconnected", qr: null, pairingCode: null, lastError: "QR code expired" });
          return;
        }
        const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(30000, 1000 * 2 ** this.retries++);
        this.setState({ status: "connecting", qr: null, lastError: msg });
        this.reconnectTimer = setTimeout(() => void this.start(), delay);
      }
    });

    sock.ev.on("messaging-history.set", (h) => {
      if (!alive()) return;
      try {
        this.ingestHistory(h);
      } catch (e) {
        logger.error(e, "history ingest failed");
      }
    });

    sock.ev.on("messaging-history.status", (s) => {
      if (s.status === "complete") {
        this.setState({ sync: { ...this.state.sync, active: false, progress: 100, lastAt: Date.now() } });
        kvSet("lastSyncAt", Date.now());
      }
    });

    sock.ev.on("lid-mapping.update", (m) => {
      repo.learnLid(m.lid, m.pn);
      this.markChatsDirty();
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (!alive()) return;
      for (const m of messages) {
        try {
          this.ingestMessage(m, { live: type === "notify" });
          // Only brand-new messages are auto-removed: incoming ones, and my own sent from this app
          // (Baileys echoes those as "append"). Messages I send from the phone and history stay.
          if ((type === "notify" && !m.key.fromMe) || (type === "append" && m.key.fromMe)) void this.maybeAutoRemove(m);
        } catch (e) {
          logger.error(e, "message ingest failed");
        }
      }
    });

    sock.ev.on("call", (calls) => {
      for (const c of calls) {
        if (c.status === "offer" || c.status === "ringing") void this.maybeRejectCall(sock, c);
      }
    });

    sock.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.id) continue;
        const chatId = this.chatIdFor(key.remoteJid, key.remoteJidAlt);
        if (!chatId) continue;
        // Revoked ("deleted for everyone"): keep the content, just flag it.
        if (update.messageStubType === proto.WebMessageInfo.StubType.REVOKE) {
          const row = repo.markDeleted(chatId, key.id, Math.floor(Date.now() / 1000), {
            from_me: key.fromMe ? 1 : 0,
            sender_jid: key.fromMe ? null : this.senderFor(key.participant, key.participantAlt) || chatId,
          });
          if (row) this.emitMessage(row.chat_id, row.id, false);
          continue;
        }
        const edited = update.message?.editedMessage?.message;
        if (edited) {
          const p = parseMessage({ key, message: edited } as WAMessage);
          const row = repo.applyEdit(chatId, key.id, p?.text ?? null, Math.floor(Date.now() / 1000));
          if (row) this.emitMessage(row.chat_id, row.id, false);
        }
        if (typeof update.status === "number") {
          const row = repo.setStatus(chatId, key.id, update.status);
          if (row) this.emitMessage(chatId, key.id, false);
        }
      }
    });

    sock.ev.on("messages.reaction", (reactions) => {
      for (const { key, reaction } of reactions) {
        if (!key.id) continue;
        const chatId = this.chatIdFor(key.remoteJid, key.remoteJidAlt);
        const fromMe = reaction.key?.fromMe;
        const sender = fromMe ? "me" : this.senderFor(reaction.key?.participant, null) || chatId || "unknown";
        const row = repo.applyReaction(chatId, key.id, sender, reaction.text || "");
        if (row) this.emitMessage(row.chat_id, row.id, false);
      }
    });

    sock.ev.on("chats.upsert", (chats) => {
      for (const c of chats) this.ingestChat(c, true);
      this.markChatsDirty();
    });
    sock.ev.on("chats.update", (chats) => {
      for (const c of chats) this.ingestChat(c, false);
      this.markChatsDirty();
    });

    sock.ev.on("contacts.upsert", (cs) => {
      db.transaction(() => cs.forEach((c) => this.ingestContact(c)))();
      this.markChatsDirty();
    });
    sock.ev.on("contacts.update", (cs) => {
      for (const c of cs) if (c.id) this.ingestContact(c as { id: string });
      this.markChatsDirty();
    });

    sock.ev.on("groups.update", (gs) => {
      for (const g of gs) if (g.id && g.subject) repo.upsertChatMeta(g.id, { name: g.subject });
      this.markChatsDirty();
    });
    sock.ev.on("groups.upsert", (gs) => {
      for (const g of gs) repo.upsertChatMeta(g.id, { name: g.subject });
      this.markChatsDirty();
    });
  }

  private async afterOpen(sock: WASocket) {
    try {
      const groups = await sock.groupFetchAllParticipating();
      db.transaction(() => {
        for (const g of Object.values(groups)) repo.upsertChatMeta(g.id, { name: g.subject });
      })();
      this.markChatsDirty();
    } catch (e) {
      logger.warn(e, "group fetch failed");
    }
    // Resume any media that was not yet copied to storage, and give earlier failures one more try.
    const cutoff = mediaCutoffTs();
    db.prepare("UPDATE messages SET media_status = 'skipped' WHERE media_status = 'pending' AND ts < ?").run(cutoff);
    db.prepare("UPDATE messages SET media_status = 'pending' WHERE media_status = 'failed' AND raw IS NOT NULL AND ts >= ?").run(cutoff);
    this.mediaQueue = this.mediaQueue.filter((j) => {
      const keep = (repo.getMessage(j.chatId, j.id)?.ts ?? 0) >= cutoff;
      if (!keep) this.mediaQueued.delete(j.chatId + "|" + j.id);
      return keep;
    });
    for (const r of repo.pendingMedia(20000)) this.enqueueMedia(r.chat_id, r.id);
  }

  private async requestPairing() {
    if (!this.sock || !this.wantPairingFor || this.state.pairingCode) return;
    try {
      const code = await this.sock.requestPairingCode(this.wantPairingFor);
      this.setState({ pairingCode: code });
    } catch (e) {
      this.setState({ lastError: "Pairing code failed: " + (e as Error).message });
    }
    this.wantPairingFor = null;
  }

  /* ------------------------------------------------------------ ingest */

  private chatIdFor(remoteJid?: string | null, alt?: string | null): string | null {
    if (!remoteJid) return null;
    if (isJidStatusBroadcast(remoteJid) || isJidBroadcast(remoteJid) || isJidNewsletter(remoteJid)) return null;
    if (isLidUser(remoteJid) && alt && isPnUser(alt)) {
      repo.learnLid(remoteJid, alt);
      return jidNormalizedUser(alt);
    }
    if (isPnUser(remoteJid) && alt && isLidUser(alt)) repo.learnLid(alt, remoteJid);
    return repo.normJid(remoteJid);
  }

  private senderFor(participant?: string | null, alt?: string | null): string | null {
    if (!participant) return null;
    if (isLidUser(participant) && alt && isPnUser(alt)) {
      repo.learnLid(participant, alt);
      return jidNormalizedUser(alt);
    }
    return repo.normJid(participant);
  }

  private ingestContact(c: { id: string; lid?: string; phoneNumber?: string; name?: string; notify?: string; verifiedName?: string }) {
    if (c.lid && c.phoneNumber) repo.learnLid(c.lid, c.phoneNumber);
    if (isLidUser(c.id) && c.phoneNumber) repo.learnLid(c.id, c.phoneNumber);
    const id = c.phoneNumber && isPnUser(c.phoneNumber) ? jidNormalizedUser(c.phoneNumber) : repo.normJid(c.id);
    if (!id || isJidGroup(id)) return;
    repo.upsertContact({ id, name: c.name, notify: c.notify, verifiedName: c.verifiedName });
  }

  private ingestChat(
    c: {
      id?: string | null;
      name?: string | null;
      unreadCount?: number | null;
      conversationTimestamp?: unknown;
      archived?: boolean | null;
      pinned?: number | null;
      muteEndTime?: unknown;
      pnJid?: string | null;
      lidJid?: string | null;
    },
    full: boolean,
  ) {
    if (!c.id) return;
    if (c.pnJid && c.lidJid) repo.learnLid(c.lidJid, c.pnJid);
    const id = this.chatIdFor(c.id, c.pnJid);
    if (!id) return;
    const ts = Number((c.conversationTimestamp as { toString(): string } | null | undefined)?.toString() || 0);
    const mute = Number((c.muteEndTime as { toString(): string } | null | undefined)?.toString() || 0);
    repo.upsertChatMeta(id, {
      name: isJidGroup(id) ? c.name : c.name || null,
      // Live chats.update can carry relative counts; only trust absolute values from full upserts,
      // or a zero (chat read on the phone).
      unread: full ? (c.unreadCount ?? null) : c.unreadCount === 0 ? 0 : null,
      lastTs: ts || null,
      archived: c.archived ?? null,
      pinned: c.pinned != null ? Number(c.pinned) : null,
      mutedUntil: c.muteEndTime != null ? mute : null,
    });
  }

  private ingestHistory(h: {
    chats: Parameters<WhatsAppManager["ingestChat"]>[0][];
    contacts: { id: string; name?: string; notify?: string; verifiedName?: string }[];
    messages: WAMessage[];
    lidPnMappings?: { lid: string; pn: string }[];
    progress?: number | null;
    isLatest?: boolean;
  }) {
    db.transaction(() => {
      for (const m of h.lidPnMappings || []) repo.learnLid(m.lid, m.pn);
      for (const c of h.contacts) this.ingestContact(c);
      for (const c of h.chats) this.ingestChat(c, true);
      for (const m of h.messages) this.ingestMessage(m, { live: false, quiet: true });
    })();
    this.setState({
      sync: {
        active: (h.progress ?? 0) < 100,
        progress: h.progress ?? this.state.sync.progress,
        chats: this.state.sync.chats + h.chats.length,
        messages: this.state.sync.messages + h.messages.length,
        lastAt: Date.now(),
      },
    });
    kvSet("lastSyncAt", Date.now());
    this.bus.emit("event", { type: "chats" } satisfies WAEvent);
    const chatIds = [...new Set(h.messages.map((m) => this.chatIdFor(m.key?.remoteJid, m.key?.remoteJidAlt)).filter(Boolean))] as string[];
    if (chatIds.length) this.bus.emit("event", { type: "history", chatIds } satisfies WAEvent);
  }

  private ingestMessage(m: WAMessage, opts: { live: boolean; quiet?: boolean }) {
    const key = m.key;
    if (!key?.id) return;
    const chatId = this.chatIdFor(key.remoteJid, key.remoteJidAlt);
    if (!chatId) return;
    const sender = key.fromMe ? null : isJidGroup(chatId) ? this.senderFor(key.participant, key.participantAlt) : chatId;
    if (sender && m.pushName && !key.fromMe) repo.upsertContact({ id: sender, notify: m.pushName });

    const p = parseMessage(m);
    if (!p) return;
    p.sender_jid = sender;
    const nowTs = Math.floor(Date.now() / 1000);

    if (p.control) {
      const c = p.control;
      let row: MessageRow | null = null;
      if (c.kind === "revoke") {
        row = repo.markDeleted(chatId, c.targetId, p.ts || nowTs, { from_me: p.from_me, sender_jid: sender, ts: p.ts });
      } else if (c.kind === "edit") {
        row = repo.applyEdit(chatId, c.targetId, c.text, p.ts || nowTs);
      } else if (c.kind === "reaction" && c.targetId) {
        row = repo.applyReaction(chatId, c.targetId, key.fromMe ? "me" : sender || chatId, c.emoji);
      }
      if (row && !opts.quiet) this.emitMessage(row.chat_id, row.id, false);
      return;
    }

    const revokedStub = m.messageStubType === proto.WebMessageInfo.StubType.REVOKE && !m.message;
    let raw: Buffer | null = null;
    // Keep the raw proto for media (re-download) and our own messages (retry receipts / quoting).
    if (p.hasMedia || key.fromMe) {
      try {
        raw = Buffer.from(proto.WebMessageInfo.encode(m).finish());
      } catch {
        raw = null;
      }
    }
    const { row, isNew } = repo.upsertMessage(chatId, p, { senderName: m.pushName || null, raw, revokedStub });
    if (isNew && p.type !== "system") {
      repo.touchChat(chatId, p.ts, opts.live && !key.fromMe);
    } else if (isNew) {
      repo.touchChat(chatId, 0, false);
    }
    if (row.media_status === "pending") {
      const own = this.outgoingMedia.get(row.id);
      if (own) {
        // We already have the bytes (we sent it): upload them once; ignore Baileys' echo meanwhile.
        if (!this.storingOwn.has(row.id)) {
          this.storingOwn.add(row.id);
          void this.storeOwnMedia(row, own.buffer, own.mime).finally(() => {
            this.storingOwn.delete(row.id);
            this.outgoingMedia.delete(row.id);
          });
        }
      } else if (!opts.live && row.ts < mediaCutoffTs()) {
        // Old media from history sync: keep the message, fetch the file only when asked.
        repo.setMedia(chatId, row.id, { status: "skipped" });
      } else {
        this.enqueueMedia(chatId, row.id, opts.live);
      }
    }
    if (!opts.quiet) this.emitMessage(chatId, row.id, isNew);
  }

  /* -------------------------------------------------------------- media */

  private mediaKey(row: MessageRow, mime: string) {
    const safeChat = row.chat_id.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return `media/${safeChat}/${row.id}.${extFromMime(mime)}`;
  }

  private async storeOwnMedia(row: MessageRow, buffer: Buffer, mime: string) {
    try {
      const key = this.mediaKey(row, mime);
      await putMedia(key, buffer, mime);
      repo.setMedia(row.chat_id, row.id, { status: "ready", key, mime, size: buffer.length });
    } catch (e) {
      logger.error(e, "store own media failed");
      repo.setMedia(row.chat_id, row.id, { status: "failed" });
    }
    this.emitMessage(row.chat_id, row.id, false);
  }

  /** Move media of the chat being viewed to the front of the queue so it loads first. */
  prioritizeMedia(chatId: string, ids: string[]) {
    const want = new Set(ids);
    const front = this.mediaQueue.filter((j) => j.chatId === chatId && want.has(j.id));
    if (!front.length) return;
    this.mediaQueue = [...front, ...this.mediaQueue.filter((j) => !(j.chatId === chatId && want.has(j.id)))];
  }

  enqueueMedia(chatId: string, id: string, priority = false) {
    const k = chatId + "|" + id;
    if (this.mediaQueued.has(k)) {
      if (priority) this.prioritizeMedia(chatId, [id]);
      return;
    }
    this.mediaQueued.add(k);
    if (priority) this.mediaQueue.unshift({ chatId, id });
    else this.mediaQueue.push({ chatId, id });
    this.pumpMedia();
  }

  private pumpMedia() {
    const concurrency = Number(process.env.MEDIA_CONCURRENCY || 3);
    while (this.mediaActive < concurrency && this.mediaQueue.length) {
      const job = this.mediaQueue.shift()!;
      this.mediaActive++;
      void this.downloadMedia(job.chatId, job.id).finally(() => {
        this.mediaActive--;
        this.mediaQueued.delete(job.chatId + "|" + job.id);
        this.updateMediaState();
        this.pumpMedia();
      });
    }
    this.updateMediaState();
  }

  private mediaStateTimer: NodeJS.Timeout | null = null;
  private updateMediaState() {
    if (this.mediaStateTimer) return;
    this.mediaStateTimer = setTimeout(() => {
      this.mediaStateTimer = null;
      const failed = (db.prepare("SELECT COUNT(*) n FROM messages WHERE media_status = 'failed'").get() as { n: number }).n;
      this.setState({ media: { queued: this.mediaQueue.length, active: this.mediaActive, failed } });
    }, 1000);
  }

  async downloadMedia(chatId: string, id: string) {
    const row = repo.getMessage(chatId, id);
    if (!row || !row.raw || row.media_status === "ready") return;
    let msg: WAMessage;
    try {
      msg = proto.WebMessageInfo.decode(row.raw) as WAMessage;
    } catch {
      repo.setMedia(chatId, id, { status: "failed" });
      return;
    }
    try {
      let buffer: Buffer;
      try {
        buffer = await withTimeout(downloadMediaMessage(msg, "buffer", {}), downloadTimeoutMs(row.media_size));
      } catch (e) {
        // Expired CDN links answer 403/404/410. Baileys' own retry checks `error.status`, but its Boom
        // errors carry the code in `output.statusCode`, so we ask the phone to re-upload ourselves.
        const code = (e as Boom).output?.statusCode;
        const sock = this.sock;
        if (!sock || this.state.status !== "open" || (code !== 403 && code !== 404 && code !== 410)) throw e;
        // The phone may never answer a re-upload request (media deleted on it, phone offline); without
        // a timeout this would hold a queue slot forever and, once every slot is held, stall all media.
        msg = await withTimeout(sock.updateMediaMessage(msg), 60_000);
        db.prepare("UPDATE messages SET raw = ? WHERE chat_id = ? AND id = ?").run(
          Buffer.from(proto.WebMessageInfo.encode(msg).finish()),
          chatId,
          id,
        );
        buffer = await withTimeout(downloadMediaMessage(msg, "buffer", {}), downloadTimeoutMs(row.media_size));
      }
      const mime = (row.media_mime || "application/octet-stream").split(";")[0];
      const key = this.mediaKey(row, mime);
      await putMedia(key, buffer, row.media_mime || mime);
      repo.setMedia(chatId, id, { status: "ready", key, size: buffer.length });
    } catch (e) {
      logger.warn({ err: (e as Error).message, code: (e as Boom).output?.statusCode, chatId, id }, "media download failed");
      repo.setMedia(chatId, id, { status: "failed" });
    }
    this.emitMessage(chatId, id, false);
  }

  retryMedia(chatId: string, id: string) {
    const row = repo.getMessage(chatId, id);
    if (!row || !row.raw) return false;
    repo.setMedia(chatId, id, { status: "pending" });
    this.enqueueMedia(chatId, id, true);
    this.emitMessage(chatId, id, false);
    return true;
  }

  /**
   * Development only: push a synthetic WhatsApp message through the exact same ingest path as
   * live traffic. `media` (if given) is stored as the message's attachment instead of downloading.
   */
  devIngest(m: WAMessage, media?: { buffer: Buffer; mime: string }) {
    if (process.env.NODE_ENV === "production") throw new Error("disabled in production");
    if (media && m.key.id) this.outgoingMedia.set(m.key.id, media);
    this.ingestMessage(m, { live: true });
  }

  /* ------------------------------------------------- filtered numbers */

  reloadFiltered() {
    this.filtered = new Map(repo.listFiltered().map((f) => [f.pn, f.created_at]));
    this.markChatsDirty(); // filtered chats are hidden from the sidebar
  }

  /** Map any sender id (phone JID, LID, device JID) to its phone-number JID, if we can. */
  private async toPn(jid: string | null | undefined, alt?: string | null): Promise<string | null> {
    if (alt && isPnUser(alt)) return jidNormalizedUser(alt);
    if (!jid) return null;
    const n = jidNormalizedUser(jid);
    if (isPnUser(n)) return n;
    if (isLidUser(n)) {
      const known = repo.normJid(n);
      if (known && isPnUser(known)) return known;
      try {
        const pn = await this.sock?.signalRepository.lidMapping.getPNForLID(n);
        if (pn) {
          const p = jidNormalizedUser(pn);
          repo.learnLid(n, p);
          return p;
        }
      } catch {
        /* unknown */
      }
    }
    return null;
  }

  private async maybeRejectCall(sock: WASocket, c: { id: string; from: string; callerPn?: string; isVideo?: boolean; date: Date; chatId: string }) {
    if (!this.filtered.size || this.rejectedCalls.has(c.id)) return;
    const pn = await this.toPn(c.from, c.callerPn);
    if (!pn || !this.filtered.has(pn)) return;
    console.info("[filter] rejecting call", { status: "offer", video: Boolean(c.isVideo) });
    this.rejectedCalls.add(c.id);
    try {
      await sock.rejectCall(c.id, c.from);
    } catch (e) {
      this.rejectedCalls.delete(c.id);
      logger.error({ err: (e as Error).message, callId: c.id }, "auto-reject call failed");
      return;
    }
    repo.bumpFiltered(pn, "calls_rejected");
    const ts = Math.floor((c.date?.getTime?.() || Date.now()) / 1000);
    const row = repo.insertSystemMessage(pn, `call-${c.id}`, ts, `📵 ${c.isVideo ? "Video call" : "Voice call"} rejected automatically`);
    repo.touchChat(pn, ts, false);
    if (row) this.emitMessage(pn, row.id, true);
  }

  /**
   * New message in a chat with a filtered number, either from them or sent by me from this app
   * (not from the phone): make sure it (and its media) is archived here, then "delete for me" on WhatsApp
   * so it disappears from the phone. The other side still has it. Messages from before the number
   * was added are never touched.
   */
  private async maybeAutoRemove(m: WAMessage) {
    if (!this.filtered.size || !m.key.id || !m.key.remoteJid) return;
    const fromMe = Boolean(m.key.fromMe);
    const group = isJidGroup(m.key.remoteJid);
    if (fromMe && (group || !this.sentHere.has(m.key.id))) return; // only my 1:1 messages sent from this app
    const p = parseMessage(m);
    if (!p || p.control || p.type === "system") return; // reactions, edits, revokes, stubs
    const senderPn = group
      ? await this.toPn(m.key.participant, m.key.participantAlt)
      : await this.toPn(m.key.remoteJid, m.key.remoteJidAlt);
    const since = senderPn ? this.filtered.get(senderPn) : undefined;
    if (!senderPn || since === undefined) return;
    const ts = Number(m.messageTimestamp?.toString() || Math.floor(Date.now() / 1000));
    if (ts < since) return;
    const once = m.key.remoteJid + "|" + m.key.id;
    if (this.autoRemoved.has(once)) return;
    this.autoRemoved.add(once);
    if (!fromMe) void this.sendFilterAlert();

    const chatId = this.chatIdFor(m.key.remoteJid, m.key.remoteJidAlt);
    if (!chatId) return;
    // Media must be safely in storage before WhatsApp forgets it.
    let row = repo.getMessage(chatId, m.key.id);
    if (row?.media_status === "pending" && (this.storingOwn.has(m.key.id) || this.outgoingMedia.has(m.key.id))) {
      // Sent from this app: the upload of our own bytes is already under way; wait for it.
      for (let i = 0; i < 240 && repo.getMessage(chatId, m.key.id)?.media_status === "pending"; i++) {
        await new Promise((res) => setTimeout(res, 500));
      }
      row = repo.getMessage(chatId, m.key.id);
    }
    if (row?.media_status === "pending") {
      await this.downloadMedia(chatId, m.key.id);
      row = repo.getMessage(chatId, m.key.id);
      if (row?.media_status !== "ready") {
        logger.warn({ chatId, id: m.key.id }, "auto-remove: media not saved, leaving message on phone");
        return;
      }
    }

    if (row && row.media_status !== "none" && row.media_status !== "ready") {
      logger.warn({ chatId, id: m.key.id }, "auto-remove: media not saved, leaving message on phone");
      return;
    }

    const sock = this.sock;
    if (!sock) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Same patch as chatModify({ deleteForMe }), but with the real sender in group chats
        // (Baileys hard-codes "0", which only addresses 1:1 messages).
        await sock.appPatch({
          // `timestamp` (when the action happened) is required: Baileys' chatModify adds it, appPatch doesn't,
          // and the phone silently ignores a delete-for-me action without it.
          syncAction: { timestamp: Date.now(), deleteMessageForMeAction: { deleteMedia: true, messageTimestamp: ts } },
          index: ["deleteMessageForMe", m.key.remoteJid, m.key.id, fromMe ? "1" : "0", group ? m.key.participant || "0" : "0"],
          type: "regular_high",
          apiVersion: 3,
          operation: proto.SyncdMutation.SyncdOperation.SET,
        });
        console.info("[filter] delete-for-me sent", {
          chat: m.key.remoteJid.split("@")[1],
          group,
          fromMe,
          participant: group ? (m.key.participant || "").split("@")[1] : null,
          messageTs: ts,
        });
        const updated = repo.markRemovedFromPhone(chatId, m.key.id);
        repo.bumpFiltered(senderPn, "removed_count");
        if (updated) this.emitMessage(chatId, m.key.id, false);
        return;
      } catch (e) {
        logger.warn({ err: (e as Error).message, attempt }, "auto-remove: delete-for-me failed");
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  /**
   * Tell the alert number (Settings > Alerts) that a hidden number wrote. Sends only the configured
   * generic text, never the received message, and at most once per cooldown.
   */
  private async sendFilterAlert() {
    const a = repo.getAlertSettings();
    if (!a.phone) return;
    if (Date.now() - this.lastAlertAt < a.cooldownMin * 60_000) return;
    this.lastAlertAt = Date.now();
    try {
      await this.sendText(a.phone, a.text);
      console.info("[filter] alert sent");
    } catch (e) {
      this.lastAlertAt = 0;
      logger.warn({ err: (e as Error).message }, "filter alert failed");
    }
  }

  /** Settings > Alerts "Send test": sends the alert text now, ignoring the cooldown. */
  async sendTestAlert() {
    const a = repo.getAlertSettings();
    if (!a.phone) throw new Error("Set an alert number first");
    await this.sendText(a.phone, a.text);
  }

  /* ------------------------------------------------------------ actions */

  private requireSock(): WASocket {
    if (!this.sock || this.state.status !== "open") throw new Error("WhatsApp is not connected");
    return this.sock;
  }

  async sendText(chatId: string, text: string, quotedId?: string) {
    const sock = this.requireSock();
    return this.send(sock, chatId, { text }, quotedId);
  }

  async sendMedia(
    chatId: string,
    file: { buffer: Buffer; mime: string; name: string },
    opts: { caption?: string; asDocument?: boolean; voice?: { seconds?: number }; quotedId?: string },
  ) {
    const sock = this.requireSock();
    const { buffer, mime, name } = file;
    let content: AnyMessageContent;
    if (opts.voice) {
      content = { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: opts.voice.seconds };
    } else if (opts.asDocument) {
      content = { document: buffer, mimetype: mime, fileName: name, caption: opts.caption };
    } else if (mime.startsWith("image/") && mime !== "image/gif") {
      content = { image: buffer, mimetype: mime, caption: opts.caption };
    } else if (mime.startsWith("video/") || mime === "image/gif") {
      content = { video: buffer, mimetype: mime === "image/gif" ? "video/mp4" : mime, caption: opts.caption, gifPlayback: mime === "image/gif" };
    } else if (mime.startsWith("audio/")) {
      content = { audio: buffer, mimetype: mime, ptt: false };
    } else {
      content = { document: buffer, mimetype: mime, fileName: name, caption: opts.caption };
    }
    const storedMime = opts.voice ? "audio/ogg; codecs=opus" : mime;
    return this.send(sock, chatId, content, opts.quotedId, { buffer, mime: storedMime });
  }

  private async send(
    sock: WASocket,
    chatId: string,
    content: AnyMessageContent,
    quotedId?: string,
    media?: { buffer: Buffer; mime: string },
  ) {
    let quoted: WAMessage | undefined;
    if (quotedId) {
      const q = repo.getMessage(chatId, quotedId);
      if (q) {
        quoted = q.raw
          ? (proto.WebMessageInfo.decode(q.raw) as WAMessage)
          : ({
              key: { remoteJid: chatId, id: q.id, fromMe: !!q.from_me, participant: q.sender_jid || undefined },
              message: { conversation: q.text || "" },
            } as WAMessage);
      }
    }
    const messageId = generateMessageIDV2(sock.user?.id);
    this.sentHere.add(messageId);
    setTimeout(() => this.sentHere.delete(messageId), 10 * 60_000);
    if (media) this.outgoingMedia.set(messageId, media);
    let sent: WAMessage | undefined;
    try {
      sent = await sock.sendMessage(chatId, content, { quoted, messageId });
    } catch (e) {
      this.outgoingMedia.delete(messageId);
      throw e;
    }
    // Baileys normally emits our own message through messages.upsert; ingest defensively too.
    if (sent) this.ingestMessage(sent, { live: false });
    return sent?.key.id || messageId;
  }

  /** Ask the phone for messages older than the oldest one we have in this chat (on-demand history sync). */
  async fetchOlder(chatId: string, count = 50) {
    const sock = this.requireSock();
    const oldest = db
      .prepare("SELECT id, from_me, ts, sender_jid FROM messages WHERE chat_id = ? ORDER BY ts ASC LIMIT 1")
      .get(chatId) as { id: string; from_me: number; ts: number; sender_jid: string | null } | undefined;
    if (!oldest) throw new Error("No messages in this chat to anchor the request");
    await sock.fetchMessageHistory(
      count,
      { remoteJid: chatId, id: oldest.id, fromMe: !!oldest.from_me, participant: isJidGroup(chatId) ? oldest.sender_jid || undefined : undefined },
      oldest.ts,
    );
  }

  /**
   * Clears the unread badge in this app. Read receipts are sent only for chats whose "Read receipts"
   * switch is on; otherwise reading a chat here never turns the sender's ticks blue (they keep
   * seeing grey "delivered" ticks).
   */
  async markRead(chatId: string) {
    repo.upsertChatMeta(chatId, { unread: 0 });
    this.markChatsDirty();
    await this.sendReadReceipts(chatId);
  }

  /** Per-chat read receipts switch (Chat header). Turning it on sends receipts for the open chat now. */
  async setReadReceipts(chatId: string, on: boolean) {
    repo.setReadReceipts(chatId, on);
    this.markChatsDirty();
    if (on) await this.sendReadReceipts(chatId);
  }

  private async sendReadReceipts(chatId: string) {
    const chat = repo.getChat(chatId);
    if (!chat?.read_receipts) return;
    const sock = this.sock;
    if (!sock || this.state.status !== "open") return;
    const rows = repo.pendingReceipts(chatId, chat.receipts_ts);
    if (!rows.length) return;
    const group = isJidGroup(chatId);
    try {
      // Baileys sends "read" (blue ticks) only if WhatsApp's own Read receipts privacy setting is on;
      // otherwise it sends "read-self", which the sender never sees.
      await sock.readMessages(
        rows.map((r) => ({ remoteJid: chatId, id: r.id, fromMe: false, participant: group ? r.sender_jid || undefined : undefined })),
      );
      repo.setReceiptsTs(chatId, rows[rows.length - 1].ts);
    } catch (e) {
      logger.warn({ err: (e as Error).message, chatId }, "sending read receipts failed");
    }
  }

  async react(chatId: string, id: string, emoji: string) {
    const sock = this.requireSock();
    const row = repo.getMessage(chatId, id);
    if (!row) throw new Error("message not found");
    await sock.sendMessage(chatId, {
      react: {
        text: emoji,
        key: { remoteJid: chatId, id, fromMe: !!row.from_me, participant: row.from_me ? undefined : row.sender_jid || undefined },
      },
    });
    const updated = repo.applyReaction(chatId, id, "me", emoji);
    if (updated) this.emitMessage(chatId, id, false);
  }

  async avatarUrl(jid: string): Promise<string | null> {
    const chat = repo.getChat(jid);
    const day = 24 * 3600;
    const now = Math.floor(Date.now() / 1000);
    if (chat && chat.avatar_checked_at > now - day) return chat.avatar_url;
    if (!this.sock || this.state.status !== "open") return chat?.avatar_url ?? null;
    let url: string | null = null;
    try {
      url = (await this.sock.profilePictureUrl(jid, "preview", 5000)) || null;
    } catch {
      url = null;
    }
    if (chat) db.prepare("UPDATE chats SET avatar_url = ?, avatar_checked_at = ? WHERE id = ?").run(url, now, jid);
    return url;
  }

  async logout() {
    const sock = this.sock;
    this.generation++; // detach listeners from the old socket
    this.sock = null;
    try {
      await sock?.logout();
    } catch {
      /* ignore */
    }
    try {
      sock?.end(undefined);
    } catch {
      /* ignore */
    }
    await this.wipeAuth();
    this.setState({ status: "disconnected", qr: null, pairingCode: null, me: null });
  }

  /** Stop media work for an account that is no longer linked (its files can't be re-requested). */
  private clearMediaQueue() {
    this.mediaQueue = [];
    this.mediaQueued.clear();
    this.updateMediaState();
  }

  private async wipeAuth() {
    this.clearMediaQueue();
    await fs.promises.rm(AUTH_DIR, { recursive: true, force: true });
  }
}

declare global {
  var __waManager: WhatsAppManager | undefined;
}

export const wa: WhatsAppManager = globalThis.__waManager ?? (globalThis.__waManager = new WhatsAppManager());

/** Auto-resume a paired session when the server boots. */
export function bootWhatsApp() {
  if (wa.hasSession() && wa.state.status === "disconnected") {
    void wa.start().catch((e) => console.error("[wa] start failed", e));
  }
}
