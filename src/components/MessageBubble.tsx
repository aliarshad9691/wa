"use client";
import { memo, useEffect, useRef, useState } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Contact,
  Download,
  FileText,
  LoaderCircle,
  MapPin,
  Mic,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Reply,
  ChartBar,
} from "lucide-react";
import type { Message } from "./types";
import { colorFor, formatBytes, formatDuration, mediaUrl, timeOf } from "./util";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="break-all text-[#027eb5] hover:underline dark:text-[#53bdeb]">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function Ticks({ status }: { status: number }) {
  if (status === 0) return <Ban size={14} className="text-deleted-fg" />;
  if (status === 1) return <Clock size={13} />;
  if (status === 2) return <Check size={16} />;
  return <CheckCheck size={16} className={status >= 4 ? "text-tick" : ""} />;
}

export interface BubbleProps {
  m: Message;
  isGroup: boolean;
  first: boolean; // first in a run from the same sender
  highlighted: boolean;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onRetry: (m: Message) => void;
  onOpenMedia: (m: Message) => void;
  onJump: (id: string) => void;
}

function MessageBubbleImpl({ m, isGroup, first, highlighted, onReply, onReact, onRetry, onOpenMedia, onJump }: BubbleProps) {
  const [menu, setMenu] = useState(false);
  // touch screens have no hover: a long press opens the message menu
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = () => {
    cancelPress();
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      setMenu(true);
      navigator.vibrate?.(10);
    }, 450);
  };
  useEffect(() => cancelPress, []);
  const [showHistory, setShowHistory] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (m.type === "system") {
    return (
      <div className="my-2 flex justify-center px-[9%]">
        <span className="bubble rounded-lg bg-system px-3 py-1.5 text-center text-[12.5px] text-muted">{m.text}</span>
      </div>
    );
  }

  const out = m.fromMe;
  const sticker = m.type === "sticker" && !m.isDeleted;
  const mediaFirst = ["image", "video", "sticker"].includes(m.type);
  const bg = m.isDeleted ? "bg-deleted" : out ? "bg-bubble-out" : "bg-bubble-in";
  const tail = first && !sticker ? (out ? "bubble-tail-out" : "bubble-tail-in") : "";
  const noContent = m.isDeleted && !m.text && !m.media;

  return (
    <div
      id={`msg-${m.id}`}
      className={`group flex px-[4%] md:px-[7%] ${out ? "justify-end" : "justify-start"} ${first ? "mt-3" : "mt-0.5"} ${
        highlighted ? "flash" : ""
      }`}
    >
      <div
        onTouchStart={noContent ? undefined : startPress}
        onTouchMove={cancelPress}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
        onContextMenu={(e) => {
          // iOS/Android fire this on long press: use our menu instead of the browser's
          if (!noContent && window.matchMedia("(hover: none)").matches) e.preventDefault();
        }}
        className={`bubble-touch relative max-w-[85%] md:max-w-[65%] ${sticker ? "" : `bubble rounded-lg ${bg} ${tail}`} ${
          m.isDeleted ? "bubble-deleted ring-1 ring-deleted-border/60" : ""
        } ${first && !sticker ? (out ? "rounded-tr-none" : "rounded-tl-none") : ""}`}
      >
        {/* hover menu */}
        {!noContent && (
          <div ref={menuRef} className={`absolute top-1 right-1 z-10 ${menu ? "block" : "hidden group-hover:block"}`}>
            <button
              onClick={() => setMenu((v) => !v)}
              className={`rounded-full p-0.5 text-muted ${m.isDeleted ? "bg-deleted" : out ? "bg-bubble-out" : "bg-bubble-in"}`}
            >
              <ChevronDown size={18} />
            </button>
            {menu && (
              <div className={`absolute top-7 ${out ? "right-0" : "left-0"} w-52 rounded-md bg-panel py-2 text-[14.5px] text-fg shadow-lg`}>
                <div className="flex justify-around px-2 pb-2">
                  {QUICK_REACTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => {
                        setMenu(false);
                        onReact(m, e);
                      }}
                      className="rounded-full p-1 text-lg transition hover:scale-125"
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <MenuItem
                  icon={<Reply size={16} />}
                  label="Reply"
                  onClick={() => {
                    setMenu(false);
                    onReply(m);
                  }}
                />
                {m.text && (
                  <MenuItem
                    icon={<FileText size={16} />}
                    label="Copy text"
                    onClick={() => {
                      setMenu(false);
                      void navigator.clipboard.writeText(m.text || "");
                    }}
                  />
                )}
                {m.media?.status === "ready" && (
                  <a
                    href={mediaUrl(m.chatId, m.id, true)}
                    onClick={() => setMenu(false)}
                    className="flex items-center gap-3 px-5 py-2 hover:bg-panel-hover"
                  >
                    <Download size={16} className="text-muted" /> Download
                  </a>
                )}
                {m.isEdited && (
                  <MenuItem
                    icon={<Pencil size={16} />}
                    label="Edit history"
                    onClick={() => {
                      setMenu(false);
                      setShowHistory(true);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}

        <div className={sticker ? "" : mediaFirst && m.media ? "p-[3px]" : "px-[9px] pt-[6px] pb-[8px]"}>
          {/* deleted banner */}
          {m.isDeleted && (
            <div
              className={`mb-1 flex items-center gap-1.5 text-[12px] font-medium text-deleted-fg ${mediaFirst && m.media ? "px-[6px] pt-[3px]" : ""}`}
              title={m.deletedAt ? `Deleted ${new Date(m.deletedAt * 1000).toLocaleString()}` : "Deleted"}
            >
              <Ban size={13} />
              {out ? "You deleted this message" : "Deleted by sender"}
              {m.deletedAt ? ` · ${timeOf(m.deletedAt)}` : ""}
            </div>
          )}

          {isGroup && !out && first && m.senderName && (
            <div className={`mb-0.5 text-[12.8px] font-medium ${mediaFirst && m.media ? "px-[6px] pt-[3px]" : ""}`} style={{ color: colorFor(m.senderJid) }}>
              {m.senderName}
            </div>
          )}

          {m.quoted && (
            <button
              onClick={() => onJump(m.quoted!.id)}
              className={`mb-1 flex w-full min-w-[160px] overflow-hidden rounded-md bg-quote text-left ${mediaFirst && m.media ? "" : ""}`}
            >
              <span className="w-1 shrink-0" style={{ background: colorFor(m.quoted.sender) }} />
              <span className="min-w-0 px-2 py-1.5">
                <span className="block text-[12.8px] font-medium" style={{ color: colorFor(m.quoted.sender) }}>
                  {m.quoted.sender || "You"}
                </span>
                <span className="line-clamp-3 text-[13px] text-muted">{m.quoted.text || "Media"}</span>
              </span>
            </button>
          )}

          {noContent ? (
            <div className="pr-14 text-[14px] text-deleted-fg italic">This message was deleted before its content was captured.</div>
          ) : (
            <Body m={m} onRetry={onRetry} onOpenMedia={onOpenMedia} />
          )}

          {/* caption / text */}
          {m.text && m.type !== "text" && m.type !== "location" && m.type !== "contact" && m.type !== "poll" && m.type !== "unknown" && (
            <div className={`text-[14.2px] leading-[19px] break-words whitespace-pre-wrap text-fg ${mediaFirst ? "px-[6px] pt-1.5 pb-1" : "pt-1"}`}>
              {linkify(m.text)}
              <span className="inline-block w-[70px]" />
            </div>
          )}

          {/* footer */}
          <div
            className={`flex items-center justify-end gap-1 text-[11px] ${
              sticker
                ? "mt-1 ml-auto w-fit rounded-full bg-black/40 px-1.5 py-0.5 text-white"
                : mediaFirst && m.media && !m.text
                  ? `absolute right-2 ${m.type === "video" && m.media.status === "ready" ? "top-2" : "bottom-2"} rounded-full bg-black/40 px-1.5 py-0.5 text-white`
                  : "float-right -mt-[10px] ml-2 h-[15px] translate-y-[5px] text-muted"
            }`}
          >
            {m.removedFromPhone && (
              <span className="mr-0.5 italic" title="Saved here, then deleted from WhatsApp on your phone (filtered number)">
                Removed from phone ·
              </span>
            )}
            {m.isEdited && (
              <button onClick={() => setShowHistory((v) => !v)} className="mr-0.5 text-edited italic hover:underline" title="Show edit history">
                Edited
              </button>
            )}
            <span>{timeOf(m.ts)}</span>
            {out && !m.isDeleted && (
              <span className={mediaFirst && m.media && !m.text ? "" : "text-muted"}>
                <Ticks status={m.status} />
              </span>
            )}
          </div>
          <div className="clear-both" />
        </div>

        {showHistory && m.editHistory.length > 0 && (
          <div className="mx-[9px] mb-2 rounded-md border border-line bg-panel/70 p-2 text-[12.5px]">
            <div className="mb-1 font-medium text-edited">Previous versions</div>
            {m.editHistory.map((h, i) => (
              <div key={i} className="border-t border-line py-1 first:border-0">
                <div className="whitespace-pre-wrap text-fg-2 line-through decoration-muted/40">{h.text || <i>empty</i>}</div>
                <div className="text-[11px] text-muted">replaced {new Date(h.ts * 1000).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {m.reactions.length > 0 && (
          <div className={`absolute -bottom-4 ${out ? "right-3" : "left-3"} flex gap-0.5 rounded-full bg-panel px-1.5 py-0.5 text-[13px] shadow`}>
            {m.reactions.map((r) => (
              <button key={r.emoji} onClick={() => r.mine && onReact(m, "")} title={r.mine ? "Remove your reaction" : undefined}>
                {r.emoji}
                {r.count > 1 && <span className="ml-0.5 text-[11px] text-muted">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {m.reactions.length > 0 && <div className="h-4" />}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-panel-hover">
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}

function MediaPlaceholder({ m, onRetry, children }: { m: Message; onRetry: (m: Message) => void; children?: React.ReactNode }) {
  const st = m.media?.status;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {st === "pending" && (
        <span className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-[13px] text-white">
          <LoaderCircle size={16} className="animate-spin" /> Saving to storage…
        </span>
      )}
      {st === "skipped" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetry(m);
          }}
          className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-[13px] text-white hover:bg-black/70"
        >
          <Download size={15} /> Download {m.media?.size ? `· ${formatBytes(m.media.size)}` : ""}
        </button>
      )}
      {st === "failed" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetry(m);
          }}
          className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-[13px] text-white hover:bg-black/70"
        >
          <RefreshCw size={15} /> Retry download {m.media?.size ? `· ${formatBytes(m.media.size)}` : ""}
        </button>
      )}
      {children}
    </div>
  );
}

function boxSize(m: Message, max = 330) {
  const w = m.media?.width || 0;
  const h = m.media?.height || 0;
  if (!w || !h) return { width: max, height: Math.round(max * 0.75) };
  const ratio = h / w;
  const width = Math.min(max, Math.max(200, w));
  return { width, height: Math.min(Math.round(width * ratio), 420) };
}

function Body({ m, onRetry, onOpenMedia }: { m: Message; onRetry: (m: Message) => void; onOpenMedia: (m: Message) => void }) {
  const ready = m.media?.status === "ready";
  const thumb = m.media?.thumbnail ? `data:image/jpeg;base64,${m.media.thumbnail}` : null;

  switch (m.type) {
    case "text":
    case "unknown":
      return (
        <div className="text-[14.2px] leading-[19px] break-words whitespace-pre-wrap text-fg">
          {m.text ? linkify(m.text) : <i className="text-muted">Unsupported message</i>}
          <span className="inline-block w-[70px]" />
        </div>
      );
    case "image": {
      const size = boxSize(m);
      return (
        <div className="relative cursor-pointer overflow-hidden rounded-md bg-black/10" style={size} onClick={() => ready && onOpenMedia(m)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {ready ? <img src={mediaUrl(m.chatId, m.id)} alt="" className="h-full w-full object-cover" loading="lazy" /> : thumb && <img src={thumb} alt="" className="h-full w-full scale-110 object-cover blur-sm" />}
          {!ready && <MediaPlaceholder m={m} onRetry={onRetry} />}
        </div>
      );
    }
    case "video": {
      const size = boxSize(m);
      return (
        <div className="relative overflow-hidden rounded-md bg-black" style={size}>
          {ready ? (
            <video src={mediaUrl(m.chatId, m.id)} poster={thumb || undefined} controls preload="metadata" className="h-full w-full object-contain" />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumb && <img src={thumb} alt="" className="h-full w-full object-cover opacity-70 blur-[2px]" />}
              <MediaPlaceholder m={m} onRetry={onRetry} />
            </>
          )}
          {m.media?.seconds ? (
            <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-1.5 text-[11px] text-white">
              {formatDuration(m.media.seconds)}
            </span>
          ) : null}
        </div>
      );
    }
    case "sticker":
      return (
        <div className="relative h-[150px] w-[150px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {ready ? <img src={mediaUrl(m.chatId, m.id)} alt="sticker" className="h-full w-full object-contain" /> : <MediaPlaceholder m={m} onRetry={onRetry} />}
        </div>
      );
    case "audio":
    case "ptt":
      return <AudioPlayer m={m} onRetry={onRetry} />;
    case "document":
      return (
        <div className="min-w-[240px]">
          <div className="flex items-center gap-3 rounded-md bg-quote px-3 py-3">
            <FileText size={30} className="shrink-0 text-[#e45d5d]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] text-fg">{m.media?.fileName || "Document"}</div>
              <div className="text-[12px] text-muted">
                {(m.media?.fileName?.split(".").pop() || m.media?.mime?.split("/")[1] || "").toUpperCase()}
                {m.media?.size ? ` · ${formatBytes(m.media.size)}` : ""}
              </div>
            </div>
            {ready ? (
              <a href={mediaUrl(m.chatId, m.id, true)} className="rounded-full border border-muted/40 p-1.5 text-muted hover:text-fg" title="Download">
                <Download size={18} />
              </a>
            ) : m.media?.status === "failed" || m.media?.status === "skipped" ? (
              <button onClick={() => onRetry(m)} className="rounded-full border border-muted/40 p-1.5 text-muted" title={m.media?.status === "skipped" ? "Download" : "Retry"}>
                {m.media?.status === "skipped" ? <Download size={18} /> : <RefreshCw size={18} />}
              </button>
            ) : (
              <LoaderCircle size={20} className="animate-spin text-muted" />
            )}
          </div>
          <span className="inline-block h-3" />
        </div>
      );
    case "location":
      return (
        <a href={m.text?.split("\n").pop()} target="_blank" rel="noreferrer" className="flex items-start gap-2 pr-16 text-[14px] text-fg">
          <MapPin size={18} className="mt-0.5 shrink-0 text-deleted-fg" />
          <span className="whitespace-pre-wrap">{m.text?.split("\n").slice(0, -1).join("\n") || "Shared location"}</span>
        </a>
      );
    case "contact":
      return (
        <div className="flex items-center gap-2 pr-16 text-[14px] text-fg">
          <Contact size={18} className="text-muted" /> {m.text}
        </div>
      );
    case "poll":
      return (
        <div className="flex gap-2 pr-16 text-[14px] whitespace-pre-wrap text-fg">
          <ChartBar size={18} className="mt-0.5 shrink-0 text-muted" />
          {m.text?.replace(/^📊 /, "")}
        </div>
      );
    default:
      return <div className="text-[14px] text-fg">{m.text}</div>;
  }
}

function AudioPlayer({ m, onRetry }: { m: Message; onRetry: (m: Message) => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(m.media?.seconds || 0);
  const ready = m.media?.status === "ready";

  return (
    <div className="flex w-[260px] items-center gap-3 py-1 pr-1 sm:w-[300px]">
      <div className="relative shrink-0">
        <div className={`flex h-11 w-11 items-center justify-center rounded-full ${m.type === "ptt" ? "bg-accent text-white" : "bg-[#ff9a3c] text-white"}`}>
          <Mic size={20} />
        </div>
      </div>
      {ready ? (
        <button
          onClick={() => {
            const a = ref.current!;
            if (a.paused) void a.play();
            else a.pause();
          }}
          className="shrink-0 text-muted hover:text-fg"
        >
          {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
      ) : m.media?.status === "failed" || m.media?.status === "skipped" ? (
        <button onClick={() => onRetry(m)} className="shrink-0 text-muted" title={m.media?.status === "skipped" ? "Download" : "Retry download"}>
          {m.media?.status === "skipped" ? <Download size={22} /> : <RefreshCw size={22} />}
        </button>
      ) : (
        <LoaderCircle size={24} className="shrink-0 animate-spin text-muted" />
      )}
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={dur || 1}
          step={0.05}
          value={pos}
          disabled={!ready}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (ref.current) ref.current.currentTime = v;
            setPos(v);
          }}
          className="h-1 w-full cursor-pointer accent-[#00a884]"
        />
        <div className="mt-1 text-[11px] text-muted">{formatDuration(playing || pos ? pos : dur)}</div>
      </div>
      {ready && (
        <audio
          ref={ref}
          src={mediaUrl(m.chatId, m.id)}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        />
      )}
    </div>
  );
}

export default memo(MessageBubbleImpl);
