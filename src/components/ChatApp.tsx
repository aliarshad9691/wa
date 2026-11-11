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

  const openChat = useCallback((id: string, f?: FocusTarget) => {
    setActiveId(id);
    setFocus(f ?? null);
    setView("chats");
  }, []);

  // Keep the URL hash in sync so reloads return to the same chat.
  useEffect(() => {
    const fromHash = decodeURIComponent(window.location.hash.slice(1));
    const t = fromHash ? setTimeout(() => setActiveId(fromHash), 0) : null;
    const onHash = () => setActiveId(decodeURIComponent(window.location.hash.slice(1)) || null);
    window.addEventListener("hashchange", onHash);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  useEffect(() => {
    const h = activeId ? "#" + encodeURIComponent(activeId) : "";
    if (window.location.hash !== h) history.replaceState(null, "", window.location.pathname + h);
  }, [activeId]);

  const activeChat = chats.find((c) => c.id === activeId) || null;

  return (
    <div className="app-shell flex w-full justify-center">
      <div className="relative flex h-full w-full max-w-[1600px] overflow-hidden bg-panel shadow-[0_6px_18px_rgba(11,20,26,0.05)]">
        {/* Left column */}
        <aside
          className={`flex h-full w-full flex-col border-r border-line bg-panel md:w-[40%] md:max-w-[460px] md:min-w-[320px] lg:w-[30%] ${
            activeId && view === "chats" ? "hidden md:flex" : "flex"
          }`}
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
              onSettings={() => setView("settings")}
            />
          )}
        </aside>

        {/* Right column */}
        <main className={`h-full min-w-0 flex-1 ${activeId && view === "chats" ? "flex" : "hidden md:flex"}`}>
          {activeId ? (
            <ChatPane
              key={activeId}
              chatId={activeId}
              chat={activeChat}
              wa={wa}
              events={events}
              focus={focus?.chatId === activeId ? focus : null}
              onBack={() => setActiveId(null)}
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
