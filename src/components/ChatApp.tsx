"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatItem, Message, SessionUser, WAState } from "./types";
import Sidebar from "./Sidebar";
import ChatPane from "./ChatPane";
import SettingsPanel from "./SettingsPanel";
import EmptyPane from "./EmptyPane";

export type FocusTarget = { chatId: string; messageId: string; ts: number } | null;

const INITIAL_STATE: WAState = {
  status: "connecting",
  qr: null,
  pairingCode: null,
  me: null,
  lastError: null,
  sync: { active: false, progress: null, chats: 0, messages: 0, lastAt: null },
  media: { queued: 0, active: 0, failed: 0 },
};

export default function ChatApp({ user }: { user: SessionUser }) {
  const [wa, setWa] = useState<WAState>(INITIAL_STATE);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [view, setView] = useState<"chats" | "settings">("chats");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusTarget>(null);
  const [online, setOnline] = useState(true);
  const events = useMemo(() => new EventTarget(), []);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Keep the app frame equal to the visible area (iPhone toolbars, on-screen keyboard). iOS scrolls
  // the whole page up when the keyboard opens; pinning the frame to visualViewport stops that.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
        root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
        root.classList.toggle("kb-open", window.innerHeight - vv.height > 120);
        if (window.scrollY !== 0 && vv.offsetTop === 0) window.scrollTo(0, 0);
      });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      root.style.removeProperty("--vvh");
      root.style.removeProperty("--vv-top");
      root.classList.remove("kb-open");
    };
  }, []);

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/chats", { cache: "no-store" });
    if (res.status === 401) {
      console.error("[auth] /api/chats returned 401, going to /login");
      router.push("/login");
      return;
    }
    const data = (await res.json()) as { chats: ChatItem[] };
    setChats(data.chats);
    setChatsLoaded(true);
  }, [router]);

  const scheduleChats = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void loadChats();
    }, 250);
  }, [loadChats]);

  useEffect(() => {
    const t = setTimeout(() => void loadChats(), 0);
    return () => clearTimeout(t);
  }, [loadChats]);

  // Live updates via server-sent events.
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("open", () => setOnline(true));
      es.addEventListener("state", (e) => setWa(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("chats", () => scheduleChats());
      es.addEventListener("history", (e) => {
        events.dispatchEvent(new CustomEvent("history", { detail: JSON.parse((e as MessageEvent).data) }));
      });
      es.addEventListener("chat-changed", (e) => {
        events.dispatchEvent(new CustomEvent("chat-changed", { detail: JSON.parse((e as MessageEvent).data) }));
        scheduleChats(); // also makes the sidebar re-read the revealed hidden chats
      });
      es.addEventListener("message", (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { isNew: boolean; message: Message };
        events.dispatchEvent(new CustomEvent("message", { detail: data }));
        scheduleChats();
      });
      es.onerror = () => {
        setOnline(false);
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [events, scheduleChats]);

  // First visit with nothing linked: go straight to the QR screen.
  const [autoSettingsDone, setAutoSettingsDone] = useState(false);
  if (!autoSettingsDone && chatsLoaded && (wa.status === "disconnected" || wa.status === "qr") && chats.length === 0) {
    setAutoSettingsDone(true);
    setView("settings");
  }

  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const openChat = useCallback((id: string, f?: FocusTarget) => {
    // Opening a chat from the list adds a history entry, so the phone's back gesture / Back button
    // (iPhone Safari edge swipe, Android back) closes the chat instead of leaving the app.
    const h = "#" + encodeURIComponent(id);
    if (!activeRef.current) history.pushState({ chat: id }, "", window.location.pathname + h);
    else if (window.location.hash !== h) history.replaceState({ chat: id }, "", window.location.pathname + h);
    setActiveId(id);
    setFocus(f ?? null);
    setView("chats");
  }, []);

  const closeChat = useCallback(() => {
    // Undo our own history entry if there is one, otherwise just clear the hash.
    if ((history.state as { chat?: string } | null)?.chat) history.back();
    else {
      history.replaceState(null, "", window.location.pathname);
      setActiveId(null);
    }
  }, []);

  // Keep the URL hash in sync so reloads return to the same chat.
  useEffect(() => {
    // A fresh page starts with hidden chats locked, so a link or reload can't open one; only
    // typing the secret into search unlocks them again. Open the linked chat after the lock lands.
    const fromHash = decodeURIComponent(window.location.hash.slice(1));
    let cancelled = false;
    const t = setTimeout(() => {
      void fetch("/api/chats/hidden", { method: "DELETE" })
        .catch(() => {})
        .then(() => !cancelled && fromHash && setActiveId(fromHash));
    }, 0);
    const onHash = () => setActiveId(decodeURIComponent(window.location.hash.slice(1)) || null);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);
  useEffect(() => {
    const h = activeId ? "#" + encodeURIComponent(activeId) : "";
    if (window.location.hash !== h) history.replaceState(activeId ? { chat: activeId } : null, "", window.location.pathname + h);
  }, [activeId]);

  // Hidden chats the secret revealed on this page. Keep them unlocked only while they are shown
  // (search still holds the code, or one of them is open); lock again as soon as neither is true.
  const [revealed, setRevealed] = useState<ChatItem[] | null>(null);
  const [hiddenSeen, setHiddenSeen] = useState<Map<string, ChatItem>>(() => new Map());
  const onReveal = useCallback((list: ChatItem[] | null) => {
    setRevealed(list);
    if (list?.length) setHiddenSeen((prev) => new Map([...prev, ...list.map((c) => [c.id, c] as const)]));
  }, []);
  const needUnlock = Boolean(revealed) || (activeId !== null && hiddenSeen.has(activeId));
  const hadUnlock = useRef(false);
  useEffect(() => {
    if (hadUnlock.current && !needUnlock) void fetch("/api/chats/hidden", { method: "DELETE" }).catch(() => {});
    hadUnlock.current = needUnlock;
  }, [needUnlock]);

  const activeChat = chats.find((c) => c.id === activeId) || (activeId ? hiddenSeen.get(activeId) : undefined) || null;

  return (
    <div className="app-shell flex w-full justify-center">
      <div className="relative flex h-full w-full max-w-[1600px] overflow-hidden bg-panel shadow-[0_6px_18px_rgba(11,20,26,0.05)]">
        {/* Left column */}
        <aside
          className={`flex h-full w-full flex-col border-r border-line bg-panel md:w-[40%] md:max-w-[460px] md:min-w-[320px] lg:w-[30%]`}
        >
          {view === "settings" ? (
            <SettingsPanel user={user} wa={wa} onBack={() => setView("chats")} />
          ) : (
            <Sidebar
              chats={chats}
              loaded={chatsLoaded}
              activeId={activeId}
              wa={wa}
              online={online}
              user={user}
              onOpen={openChat}
              onReveal={onReveal}
              onSettings={() => setView("settings")}
            />
          )}
        </aside>

        {/* Right column */}
        <main
          className={`min-w-0 flex-1 ${
            activeId && view === "chats"
              ? "absolute inset-0 z-20 flex md:static md:z-auto" // phone: chat covers the list
              : "hidden h-full md:flex"
          } md:h-full`}
        >
          {activeId ? (
            <ChatPane
              key={activeId}
              chatId={activeId}
              chat={activeChat}
              wa={wa}
              events={events}
              focus={focus?.chatId === activeId ? focus : null}
              onBack={closeChat}
              onRead={scheduleChats}
            />
          ) : (
            <EmptyPane wa={wa} onSettings={() => setView("settings")} />
          )}
        </main>
      </div>
    </div>
  );
}
