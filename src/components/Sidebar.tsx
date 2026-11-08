"use client";
import { useEffect, useMemo, useState } from "react";
import { Ban, BellOff, Check, CheckCheck, Clock, EllipsisVertical, LoaderCircle, Pin, Search, Settings, Smartphone, WifiOff, X } from "lucide-react";
import Avatar from "./Avatar";
import type { ChatItem, Message, SessionUser, WAState } from "./types";
import { chatListTime, previewText } from "./util";
import type { FocusTarget } from "./ChatApp";

type Filter = "all" | "unread" | "groups" | "deleted";

export default function Sidebar({
  chats,
  loaded,
  activeId,
  wa,
  online,
  user,
  onOpen,
  onSettings,
}: {
  chats: ChatItem[];
  loaded: boolean;
  activeId: string | null;
  wa: WAState;
  online: boolean;
  user: SessionUser;
  onOpen: (id: string, focus?: FocusTarget) => void;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [found, setFound] = useState<Message[]>([]);
  const [deleted, setDeleted] = useState<Message[] | null>(null);

  const results = query.trim().length >= 2 ? found : [];
  const chatName = useMemo(() => new Map(chats.map((c) => [c.id, c.name])), [chats]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "groups" && !c.isGroup) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.id.includes(q.replace(/[^\d]/g, "") || "\u0000");
    });
  }, [chats, filter, query]);

  // Full-text search over stored messages.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        setFound(((await r.json()) as { messages: Message[] }).messages);
      } catch {
        /* aborted */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    if (filter !== "deleted") return;
    let cancelled = false;
    fetch("/api/deleted")
      .then((r) => r.json())
      .then((d: { messages: Message[] }) => !cancelled && setDeleted(d.messages));
    return () => {
      cancelled = true;
    };
  }, [filter, chats]);

  return (
    <>
      {/* Header */}
      <header className="flex h-[59px] shrink-0 items-center justify-between bg-panel-header px-4">
        <button onClick={onSettings} title="Profile & settings" className="rounded-full">
          <Avatar src={user.image} size={40} />
        </button>
        <div className="flex items-center gap-1 text-muted">
          <button onClick={onSettings} title="Settings" className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5">
            <Settings size={21} />
          </button>
          <button onClick={onSettings} title="Menu" className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5">
            <EllipsisVertical size={21} />
          </button>
        </div>
      </header>

      {/* Connection banner */}
      {(!online || wa.status !== "open") && (
        <button
          onClick={onSettings}
          className={`flex shrink-0 items-center gap-4 px-4 py-3 text-left ${
            !online ? "bg-[#fff3c4] dark:bg-[#4a3f10]" : wa.status === "connecting" ? "bg-[#d9eefd] dark:bg-[#13334a]" : "bg-[#fff3c4] dark:bg-[#4a3f10]"
          }`}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#c49a00] dark:bg-black/20">
            {!online ? <WifiOff size={22} /> : wa.status === "connecting" ? <LoaderCircle size={22} className="animate-spin text-[#53bdeb]" /> : <Smartphone size={22} />}
          </div>
          <div className="min-w-0">
            <div className="text-[15px] text-fg">
              {!online ? "Server unreachable" : wa.status === "connecting" ? "Connecting to phone…" : "Phone not linked"}
            </div>
            <div className="text-[13px] text-muted">
              {!online ? "Reconnecting automatically." : wa.status === "connecting" ? "Hang tight." : "Open settings to scan the QR code."}
            </div>
          </div>
        </button>
      )}
      {wa.status === "open" && wa.sync.active && (
        <div className="flex shrink-0 items-center gap-3 bg-accent-soft px-4 py-2 text-[13px] text-fg-2">
          <LoaderCircle size={16} className="animate-spin text-accent" />
          Syncing history{wa.sync.progress != null ? ` · ${wa.sync.progress}%` : ""} · {wa.sync.messages.toLocaleString()} messages
        </div>
      )}

      {/* Search */}
      <div className="shrink-0 px-3 pt-2 pb-1">
        <div className="flex h-[35px] items-center gap-3 rounded-lg bg-panel-header px-3">
          {query ? (
            <button onClick={() => setQuery("")} className="text-accent">
              <X size={18} />
            </button>
          ) : (
            <Search size={17} className="text-muted" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or start new chat"
            className="h-full w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
          />
        </div>
      </div>
      <div className="flex shrink-0 gap-2 px-3 pt-1 pb-2">
        {(
          [
            ["all", "All"],
            ["unread", "Unread"],
            ["groups", "Groups"],
            ["deleted", "Deleted"],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1.5 text-[14px] transition ${
              filter === k ? "bg-accent-soft text-accent-strong dark:text-[#00a884]" : "bg-panel-header text-muted hover:bg-panel-active"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {filter === "deleted" ? (
          <DeletedList messages={deleted} chatName={chatName} onOpen={onOpen} />
        ) : (
          <>
            {!loaded && (
              <div className="flex justify-center p-8 text-muted">
                <LoaderCircle className="animate-spin" />
              </div>
            )}
            {loaded && visible.length === 0 && (
              <div className="p-8 text-center text-sm text-muted">
                {query ? "No chats found" : wa.status === "open" ? "No chats yet — history may still be syncing." : "No chats yet."}
              </div>
            )}
            {visible.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === activeId} onClick={() => onOpen(c.id)} />
            ))}
            {results.length > 0 && (
              <>
                <div className="px-8 pt-5 pb-2 text-[15px] text-accent">Messages</div>
                {results.map((m) => (
                  <button
                    key={m.chatId + m.id}
                    onClick={() => onOpen(m.chatId, { chatId: m.chatId, messageId: m.id, ts: m.ts })}
                    className="flex w-full flex-col border-b border-line px-6 py-3 text-left hover:bg-panel-hover"
                  >
                    <div className="flex justify-between text-[13px] text-muted">
                      <span className="truncate">{chatName.get(m.chatId) || m.chatId}</span>
                      <span className="shrink-0 pl-2">{chatListTime(m.ts)}</span>
                    </div>
                    <div className="truncate text-[14px] text-fg-2">
                      {m.fromMe ? "You: " : ""}
                      {highlight(m.text || "", query)}
                    </div>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return text;
  const start = Math.max(0, i - 20);
  return (
    <>
      {start > 0 ? "…" : ""}
      {text.slice(start, i)}
      <b className="font-semibold text-accent">{text.slice(i, i + q.trim().length)}</b>
      {text.slice(i + q.trim().length)}
    </>
  );
}

function Ticks({ status }: { status: number }) {
  if (status <= 1) return <Clock size={14} className="shrink-0 text-muted" />;
  if (status === 2) return <Check size={16} className="shrink-0 text-muted" />;
  return <CheckCheck size={16} className={`shrink-0 ${status >= 4 ? "text-tick" : "text-muted"}`} />;
}

function ChatRow({ chat, active, onClick }: { chat: ChatItem; active: boolean; onClick: () => void }) {
  const l = chat.last;
  return (
    <button
      onClick={onClick}
      className={`group flex h-[72px] w-full items-center gap-3 pl-3 text-left ${active ? "bg-panel-active" : "hover:bg-panel-hover"}`}
    >
      <Avatar id={chat.id} isGroup={chat.isGroup} />
      <div className="flex h-full min-w-0 flex-1 flex-col justify-center border-b border-line pr-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[17px] text-fg">{chat.name}</span>
          <span className={`shrink-0 text-[12px] ${chat.unread ? "text-accent" : "text-muted"}`}>{chatListTime(chat.lastTs)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 text-[14px] text-muted">
            {l?.fromMe && !l.isDeleted && <Ticks status={l.status} />}
            {l?.isDeleted && <Ban size={14} className="shrink-0 text-deleted-fg" />}
            <span className="truncate">
              {l ? (
                <>
                  {chat.isGroup && l.senderName ? `${l.senderName}: ` : ""}
                  {l.isDeleted ? <span className="text-deleted-fg">Deleted{l.text || l.type !== "text" ? " · " : ""}</span> : null}
                  {l.isDeleted && !l.text && l.type === "text" ? <i>content not captured</i> : previewText(l.type, l.text)}
                </>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {chat.muted && <BellOff size={15} className="text-muted" />}
            {chat.pinned && <Pin size={15} className="rotate-45 text-muted" />}
            {chat.unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-medium text-white">
                {chat.unread}
              </span>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}

function DeletedList({
  messages,
  chatName,
  onOpen,
}: {
  messages: Message[] | null;
  chatName: Map<string, string>;
  onOpen: (id: string, focus?: FocusTarget) => void;
}) {
  if (!messages)
    return (
      <div className="flex justify-center p-8 text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  if (!messages.length)
    return <div className="p-8 text-center text-sm text-muted">No deleted messages captured yet. When someone deletes a message for everyone, it shows up here.</div>;
  return (
    <>
      <div className="px-4 pb-2 text-[13px] text-muted">Messages deleted on WhatsApp, kept here.</div>
      {messages.map((m) => (
        <button
          key={m.chatId + m.id}
          onClick={() => onOpen(m.chatId, { chatId: m.chatId, messageId: m.id, ts: m.ts })}
          className="flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-panel-hover"
        >
          <Avatar id={m.chatId} isGroup={m.chatId.endsWith("@g.us")} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-2 text-[14px]">
              <span className="truncate text-fg">{chatName.get(m.chatId) || m.chatId}</span>
              <span className="shrink-0 text-[12px] text-muted">{chatListTime(m.deletedAt || m.ts)}</span>
            </div>
            <div className="truncate text-[13px] text-muted">
              {m.fromMe ? "You" : m.senderName}: {m.text || m.media ? previewText(m.type, m.text) : <i>content not captured</i>}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}
