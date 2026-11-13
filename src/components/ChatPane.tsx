"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  // Hidden chats only: seconds after first view when a message stops being shown (null = never).
  const [viewTtl, setViewTtl] = useState<number | null>(null);
  // Hidden chats: the secret was typed into this chat's message box, so show its full history.
  const [revealAll, setRevealAll] = useState(false);
  const [nowS, setNowS] = useState(() => Date.now() / 1000);
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

  // Phone: swipe the chat to the right to close it (like WhatsApp), revealing the chat list underneath.
  const pane = useRef<HTMLDivElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const gone = useRef(false);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const phone = window.matchMedia("(max-width: 767px)");
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // samples: recent [x, time] points, for the release speed (a flick closes even when short)
    let s: { x: number; y: number; dx: number; mode: "h" | "v" | null; samples: [number, number][] } | null = null;

    const setX = (x: number, animate: boolean) => {
      el.style.transition = animate ? "transform 200ms ease-out" : "none";
      el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
      el.style.boxShadow = x ? "-8px 0 24px rgba(0,0,0,0.18)" : "";
    };
    const onStart = (e: TouchEvent) => {
      s = null;
      if (!phone.matches || e.touches.length !== 1) return;
      const t = e.touches[0];
      // Safari's own edge swipe already goes back (and closes the chat through history); don't fight it.
      if (!standalone && t.clientX < 20) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [data-no-swipe]")) return;
      s = { x: t.clientX, y: t.clientY, dx: 0, mode: null, samples: [[t.clientX, performance.now()]] };
    };
    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        s.mode = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3 ? "h" : "v";
        if (s.mode === "v") {
          s = null; // normal scrolling
          return;
        }
      }
      e.preventDefault(); // horizontal drag: don't scroll the messages
      s.dx = Math.max(0, dx);
      const now = performance.now();
      s.samples.push([t.clientX, now]);
      while (s.samples.length > 2 && now - s.samples[0][1] > 100) s.samples.shift();
      setX(s.dx, false);
    };
    const onEnd = () => {
      if (!s || s.mode !== "h") {
        s = null;
        return;
      }
      const width = el.offsetWidth;
      // speed over the last ~100 ms, in px per ms (positive = moving right)
      const [x0, t0] = s.samples[0];
      const [x1, t1] = s.samples[s.samples.length - 1];
      const speed = (x1 - x0) / Math.max(1, t1 - t0);
      const close = s.dx > width * 0.35 || (speed > 0.4 && s.dx > 40);
      s = null;
      if (close) {
        setX(width, true);
        setTimeout(() => onBackRef.current(), 180);
      } else {
        setX(0, true);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const api = useCallback(
    async (qs: string): Promise<{ messages: Message[]; hasMore: boolean }> => {
      const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages?${qs}${onlyDeleted ? "&deleted=1" : ""}`);
      if (r.status === 404) {
        // A hidden chat opened from a link without typing the secret: just go back to the list.
        if (!gone.current) {
          gone.current = true;
          onBackRef.current();
        }
        return { messages: [], hasMore: false };
      }
      const d = (await r.json()) as { messages: Message[]; hasMore: boolean; disappearAfterViewS?: number | null; revealAll?: boolean };
      setViewTtl(d.disappearAfterViewS ?? null);
      setRevealAll(Boolean(d.revealAll));
      return d;
    },
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

  // Hidden chats get no message content over the live stream, only a nudge: re-read the latest page.
  useEffect(() => {
    if (!atLatest) return;
    const onChanged = async (e: Event) => {
      if ((e as CustomEvent<{ chatId: string }>).detail.chatId !== chatId) return;
      const d = await api(`limit=${PAGE}`);
      const el = scroller.current;
      stickBottom.current = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 150 : true;
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of d.messages) byId.set(m.id, m);
        return [...byId.values()].sort((a, b) => a.ts - b.ts);
      });
      if (document.visibilityState === "visible") void fetch(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: "POST" });
    };
    events.addEventListener("chat-changed", onChanged);
    return () => events.removeEventListener("chat-changed", onChanged);
  }, [events, chatId, atLatest, api]);

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

  // Hidden chats: messages disappear (from view only) viewTtl seconds after they were first seen.
  const shown = useMemo(
    () => (viewTtl == null || revealAll ? messages : messages.filter((m) => m.viewedAt == null || m.viewedAt + viewTtl > nowS)),
    [messages, viewTtl, nowS, revealAll],
  );
  // The full history is shown only until this chat is closed.
  const revealRef = useRef(false);
  revealRef.current = revealAll;
  useEffect(() => () => void (revealRef.current && fetch("/api/chats/hidden?scope=history", { method: "DELETE" }).catch(() => {})), []);
  useEffect(() => {
    if (viewTtl == null || revealAll) return;
    const next = Math.min(...messages.filter((m) => m.viewedAt != null).map((m) => m.viewedAt! + viewTtl).filter((t) => t > nowS));
    if (!Number.isFinite(next)) return;
    const t = setTimeout(() => setNowS(Date.now() / 1000), Math.max(250, (next - Date.now() / 1000) * 1000 + 50));
    return () => clearTimeout(t);
  }, [messages, viewTtl, nowS, revealAll]);

  // ...and "seen" means on screen (in the middle part of the list) while the page is visible.
  useEffect(() => {
    const root = scroller.current;
    if (viewTtl == null || !root) return;
    const unseen = new Set(shown.filter((m) => m.viewedAt == null && m.type !== "system").map((m) => m.id));
    if (!unseen.size) return;
    const onScreen = new Set<string>();
    const queue = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = async () => {
      timer = null;
      const ids = [...queue];
      queue.clear();
      if (!ids.length) return;
      const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/viewed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).catch(() => null);
      if (!r?.ok) return ids.forEach((id) => unseen.add(id)); // try again on the next sighting
      const { viewed } = (await r.json()) as { viewed: Record<string, number> };
      setMessages((prev) => prev.map((m) => (viewed[m.id] != null && m.viewedAt == null ? { ...m, viewedAt: viewed[m.id] } : m)));
    };
    const enqueue = (id: string) => {
      if (!unseen.delete(id)) return;
      queue.add(id);
      timer ??= setTimeout(flush, 800);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id.slice(4);
          if (e.isIntersecting) onScreen.add(id);
          else onScreen.delete(id);
        }
        if (document.visibilityState === "visible") onScreen.forEach(enqueue);
      },
      { root, rootMargin: "-15% 0px -15% 0px" },
    );
    for (const id of unseen) {
      const el = document.getElementById(`msg-${id}`);
      if (el) io.observe(el);
    }
    const onVisible = () => document.visibilityState === "visible" && onScreen.forEach(enqueue);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) {
        clearTimeout(timer);
        void flush();
      }
    };
  }, [shown, viewTtl, chatId]);

  const deletedCount = messages.filter((m) => m.isDeleted).length;
  const name = chat?.name || phoneOf(chatId);

  return (
    <div ref={pane} className="relative flex h-full w-full flex-col bg-panel">
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
                {!onlyDeleted && wa.status === "open" && shown.length > 0 && (
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
                    : viewTtl != null && revealAll
                      ? "Showing the full history, including hidden messages. They are hidden again when you close this chat."
                      : viewTtl != null
                      ? shown.length
                        ? `Messages are hidden ${ttlLabel(viewTtl)} after you've seen them. They stay saved on your server.`
                        : `No new messages. Messages are hidden ${ttlLabel(viewTtl)} after you've seen them and stay saved on your server.`
                      : "Messages are archived on your server. Deleted messages stay visible and are highlighted."}
                </span>
              </div>
            )}
            {shown.map((m, i) => {
              const prev = shown[i - 1];
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
        onSent={(r) => {
          if (r.secret) {
            // Never sent. In a hidden chat it shows the full history.
            setReplyTo(null);
            setToast(r.revealed ? "Showing the full chat history" : "Not sent");
            setTimeout(() => setToast(null), 3000);
            if (r.revealed) {
              setOnlyDeleted(false);
              void loadLatest();
            }
            return;
          }
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

function ttlLabel(s: number) {
  const m = Math.round(s / 60);
  return s < 60 ? `${s} seconds` : m === 1 ? "1 minute" : `${m} minutes`;
}
