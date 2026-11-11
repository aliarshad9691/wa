"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import Avatar from "./Avatar";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";
import MediaViewer from "./MediaViewer";
import type { ChatItem, Message, WAState } from "./types";
import { dayLabel, phoneOf, startOfDay } from "./util";
import type { FocusTarget } from "./ChatApp";

const PAGE = 50;

export default function ChatPane({
  chatId,
  chat,
  wa,
  events,
  focus,
  onBack,
  onRead,
}: {
  chatId: string;
  chat: ChatItem | null;
  wa: WAState;
  events: EventTarget;
  focus: FocusTarget;
  onBack: () => void;
  onRead: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [atLatest, setAtLatest] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [viewer, setViewer] = useState<Message | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [onlyDeleted, setOnlyDeleted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [askingPhone, setAskingPhone] = useState(false);
  const [receipts, setReceipts] = useState(chat?.readReceipts ?? false);
  const [savingReceipts, setSavingReceipts] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const loadingOlder = useRef(false);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const stickBottom = useRef(true);
  const isGroup = chat?.isGroup ?? chatId.endsWith("@g.us");

  const api = useCallback(
    (qs: string) =>
      fetch(`/api/chats/${encodeURIComponent(chatId)}/messages?${qs}${onlyDeleted ? "&deleted=1" : ""}`).then(
        (r) => r.json() as Promise<{ messages: Message[]; hasMore: boolean }>,
      ),
    [chatId, onlyDeleted],
  );

  const loadLatest = useCallback(async () => {
    setLoading(true);
    const d = await api(`limit=${PAGE}`);
    stickBottom.current = true;
    setMessages(d.messages);
    setHasMore(d.hasMore);
    setAtLatest(true);
    setLoading(false);
  }, [api]);

  // initial load (or jump to a specific message)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (focus) {
        setLoading(true);
        const [older, newer] = await Promise.all([api(`before=${focus.ts + 1}&limit=30`), api(`after=${focus.ts}&limit=30`)]);
        if (cancelled) return;
        const seen = new Set<string>();
        const merged = [...older.messages, ...newer.messages].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
        setMessages(merged);
        setHasMore(older.hasMore);
        setAtLatest(!newer.hasMore);
        setLoading(false);
        stickBottom.current = false;
        setHighlight(focus.messageId);
        requestAnimationFrame(() => document.getElementById(`msg-${focus.messageId}`)?.scrollIntoView({ block: "center" }));
      } else {
        await loadLatest();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, focus, loadLatest]);

  // per-chat read receipts switch. Load it from the server for this chat: hidden (filtered) chats
  // and chats opened from search are not in the chat list, so `chat` can be null.
  useEffect(() => {
    let cancelled = false;
    setReceipts(chat?.readReceipts ?? false);
    void fetch(`/api/chats/${encodeURIComponent(chatId)}/receipts`)
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled: boolean }>) : null))
      .then((d) => {
        if (d && !cancelled) setReceipts(d.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per chat; list changes handled below
  }, [chatId]);

  // follow the chat list when it changes (another tab or device flipped the switch)
  useEffect(() => {
    if (chat) setReceipts(chat.readReceipts);
  }, [chat?.readReceipts]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleReceipts = useCallback(async () => {
    const next = !receipts;
    setReceipts(next);
    setSavingReceipts(true);
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Could not save");
      setToast(next ? "Read receipts on: messages you read here turn blue for the sender" : "Read receipts off for this chat");
      onRead();
    } catch (e) {
      setReceipts(!next);
      setToast((e as Error).message);
    } finally {
      setSavingReceipts(false);
      setTimeout(() => setToast(null), 2500);
    }
  }, [chatId, receipts, onRead]);

  // mark as read when opened / when new messages arrive while open
  useEffect(() => {
    void fetch(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: "POST" }).then(onRead);
  }, [chatId, onRead]);

  // live updates
  useEffect(() => {
    const onMsg = (e: Event) => {
      const { message } = (e as CustomEvent<{ isNew: boolean; message: Message }>).detail;
      if (message.chatId !== chatId) return;
      setMessages((prev) => {
        const i = prev.findIndex((p) => p.id === message.id);
        if (i >= 0) {
          const next = prev.slice();
          next[i] = message;
          return next;
        }
        if (!atLatest) return prev;
        if (onlyDeleted && !message.isDeleted) return prev;
        const el = scroller.current;
        const nearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 150 : true;
        stickBottom.current = nearBottom || message.fromMe;
        if (!stickBottom.current) setUnseen((n) => n + 1);
        const next = [...prev, message];
        next.sort((a, b) => a.ts - b.ts);
        return next;
      });
      if (!message.fromMe && document.visibilityState === "visible") {
        void fetch(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: "POST" });
      }
    };
    events.addEventListener("message", onMsg);
    return () => events.removeEventListener("message", onMsg);
  }, [events, chatId, atLatest, onlyDeleted]);

  // scroll management
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || !hasMore || !messages.length) return;
    loadingOlder.current = true;
    const el = scroller.current!;
    const d = await api(`before=${messages[0].ts}&limit=${PAGE}`);
    restore.current = { height: el.scrollHeight, top: el.scrollTop };
    stickBottom.current = false;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...d.messages.filter((m) => !ids.has(m.id)), ...prev];
    });
    setHasMore(d.hasMore);
    loadingOlder.current = false;
  }, [api, hasMore, messages]);

  const loadNewer = useCallback(async () => {
    if (loadingOlder.current || atLatest || !messages.length) return;
    loadingOlder.current = true;
    const d = await api(`after=${messages[messages.length - 1].ts}&limit=${PAGE}`);
    stickBottom.current = false;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...prev, ...d.messages.filter((m) => !ids.has(m.id))];
    });
    setAtLatest(!d.hasMore);
    loadingOlder.current = false;
  }, [api, atLatest, messages]);

  const onScroll = () => {
    const el = scroller.current!;
    if (el.scrollTop < 300) void loadOlder();
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (fromBottom < 300 && !atLatest) void loadNewer();
    setShowJump(fromBottom > 400 || !atLatest);
    if (fromBottom < 50) setUnseen(0);
  };

  // If more history became available while we sit at the top, page it in.
  useEffect(() => {
    const el = scroller.current;
    if (hasMore && !loading && el && el.scrollTop < 300 && el.scrollHeight > 0) {
      const t = setTimeout(() => void loadOlder(), 0);
      return () => clearTimeout(t);
    }
  }, [hasMore, loading, loadOlder]);

  // When history for this chat arrives from the phone, page in what is now available.
  useEffect(() => {
    const onHistory = (e: Event) => {
      const { chatIds } = (e as CustomEvent<{ chatIds: string[] }>).detail;
      if (!chatIds.includes(chatId)) return;
      setAskingPhone(false);
      setHasMore(true);
    };
    events.addEventListener("history", onHistory);
    return () => events.removeEventListener("history", onHistory);
  }, [events, chatId]);

  const askPhoneForOlder = async () => {
    setAskingPhone(true);
    const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/history`, { method: "POST" });
    if (!r.ok) {
      setAskingPhone(false);
      setToast(((await r.json()) as { error: string }).error);
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setTimeout(() => setAskingPhone(false), 20000);
  };

  const jumpToLatest = () => {
    setUnseen(0);
    if (!atLatest) void loadLatest();
    else {
      const el = scroller.current!;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  };

  const jumpTo = useCallback(
    async (id: string) => {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlight(null);
        requestAnimationFrame(() => setHighlight(id));
        return;
      }
      setToast("Original message is not loaded — scroll up to find it.");
      setTimeout(() => setToast(null), 2500);
    },
    [],
  );

  const react = useCallback(
    async (m: Message, emoji: string) => {
      const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id)}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!r.ok) {
        setToast(((await r.json()) as { error: string }).error);
        setTimeout(() => setToast(null), 2500);
      }
    },
    [chatId],
  );

  const retry = useCallback(
    (m: Message) => {
      void fetch(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id)}/retry`, { method: "POST" });
    },
    [chatId],
  );

  const deletedCount = messages.filter((m) => m.isDeleted).length;
  const name = chat?.name || phoneOf(chatId);

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* header */}
      <header className="z-10 flex h-[59px] shrink-0 items-center gap-2 border-l border-line bg-panel-header px-3 sm:gap-3 sm:px-4">
        <button onClick={onBack} className="-m-2 rounded-full p-2 text-muted md:hidden" title="Back" aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <Avatar id={chatId} isGroup={isGroup} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] text-fg">{name}</div>
          <div className="truncate text-[13px] text-muted">
            {isGroup ? "Group" : phoneOf(chatId)}
            {wa.status !== "open" && " · phone offline (read-only)"}
          </div>
        </div>
        <button
          onClick={() => void toggleReceipts()}
          disabled={savingReceipts}
          role="switch"
          aria-checked={receipts}
          aria-label="Read receipts for this chat"
          title={
            receipts
              ? "Read receipts ON: reading this chat here turns the sender's ticks blue. Click to turn off."
              : "Read receipts OFF: the sender keeps seeing grey ticks when you read here. Click to turn on."
          }
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] disabled:opacity-60 ${
            receipts ? "text-tick ring-1 ring-tick/50" : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          <CheckCheck size={17} />
          <span className="hidden sm:inline">{receipts ? "Blue ticks on" : "Blue ticks off"}</span>
        </button>
        <button
          onClick={() => setOnlyDeleted((v) => !v)}
          title={onlyDeleted ? "Show all messages" : "Show only deleted messages"}
          aria-label={onlyDeleted ? "Show all messages" : "Show only deleted messages"}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] ${
            onlyDeleted ? "bg-deleted text-deleted-fg ring-1 ring-deleted-border" : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          {onlyDeleted ? <X size={15} /> : <Search size={17} />}
          {onlyDeleted ? (
            "Deleted only"
          ) : (
            <span className="hidden sm:inline">{`Deleted${deletedCount ? ` (${deletedCount}+)` : ""}`}</span>
          )}
        </button>
      </header>

      {/* messages */}
      <div ref={scroller} onScroll={onScroll} className="chat-wallpaper scroll-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted">
            <LoaderCircle className="animate-spin" />
          </div>
        ) : (
          <>
            {hasMore ? (
              <div className="flex justify-center py-3 text-muted">
                <LoaderCircle size={18} className="animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 pt-4">
                {!onlyDeleted && wa.status === "open" && messages.length > 0 && (
                  <button
                    onClick={askPhoneForOlder}
                    disabled={askingPhone}
                    className="bubble flex items-center gap-2 rounded-full bg-system px-4 py-1.5 text-[13px] text-accent disabled:opacity-70"
                  >
                    {askingPhone && <LoaderCircle size={14} className="animate-spin" />}
                    {askingPhone ? "Requesting older messages from phone…" : "Load older messages from phone"}
                  </button>
                )}
                <span className="rounded-lg bg-[#ffeecd] px-3 py-1.5 text-center text-[12.5px] text-[#54656f] dark:bg-[#182229] dark:text-[#ffd279]">
                  {onlyDeleted
                    ? deletedCount
                      ? "Showing only messages that were deleted on WhatsApp."
                      : "No deleted messages in this chat."
                    : "Messages are archived on your server. Deleted messages stay visible and are highlighted."}
                </span>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || startOfDay(new Date(prev.ts * 1000)) !== startOfDay(new Date(m.ts * 1000));
              const first = newDay || !prev || prev.fromMe !== m.fromMe || prev.senderJid !== m.senderJid || prev.type === "system";
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="sticky top-2 z-[5] my-3 flex justify-center">
                      <span className="bubble rounded-lg bg-system px-3 py-1.5 text-[12.5px] text-muted uppercase">{dayLabel(m.ts)}</span>
                    </div>
                  )}
                  <MessageBubble
                    m={m}
                    isGroup={isGroup}
                    first={first}
                    highlighted={highlight === m.id}
                    onReply={setReplyTo}
                    onReact={react}
                    onRetry={retry}
                    onOpenMedia={setViewer}
                    onJump={jumpTo}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      {showJump && (
        <button
          onClick={jumpToLatest}
          className="absolute right-6 bottom-[80px] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted shadow-md"
          title="Jump to latest"
        >
          <ChevronDown size={24} />
          {unseen > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] text-white">
              {unseen}
            </span>
          )}
        </button>
      )}

      {toast && (
        <div className="absolute bottom-[80px] left-1/2 z-20 -translate-x-1/2 rounded-md bg-[#323739] px-4 py-2 text-[14px] text-white shadow-lg">{toast}</div>
      )}

      <Composer
        chatId={chatId}
        disabled={wa.status !== "open"}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => {
          setReplyTo(null);
          stickBottom.current = true;
          if (!atLatest || onlyDeleted) {
            setOnlyDeleted(false);
            void loadLatest();
          }
        }}
        onError={(msg) => {
          setToast(msg);
          setTimeout(() => setToast(null), 3500);
        }}
      />

      {viewer && <MediaViewer m={viewer} title={viewer.fromMe ? "You" : viewer.senderName || name} onClose={() => setViewer(null)} />}
    </div>
  );
}
