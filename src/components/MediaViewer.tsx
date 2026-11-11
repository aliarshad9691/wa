"use client";
import { useEffect } from "react";
import { Download, X } from "lucide-react";
import type { Message } from "./types";
import { mediaUrl, timeOf } from "./util";

export default function MediaViewer({ m, title, onClose }: { m: Message; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-no-swipe
      className="fixed inset-0 z-50 flex flex-col bg-panel/95 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex h-[59px] shrink-0 items-center justify-between px-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-fg">{title}</div>
          <div className="text-[13px] text-muted">
            {new Date(m.ts * 1000).toLocaleDateString()} at {timeOf(m.ts)}
            {m.isDeleted && <span className="ml-2 text-deleted-fg">· deleted on WhatsApp</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-muted">
          <a href={mediaUrl(m.chatId, m.id, true)} className="rounded-full p-2 hover:bg-panel-hover" title="Download">
            <Download size={22} />
          </a>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-panel-hover" title="Close">
            <X size={24} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {m.type === "video" ? (
          <video src={mediaUrl(m.chatId, m.id)} controls autoPlay className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(m.chatId, m.id)} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        )}
      </div>
      {m.text && (
        <div className="shrink-0 px-6 pb-8 text-center text-[15px] whitespace-pre-wrap text-fg" onClick={(e) => e.stopPropagation()}>
          {m.text}
        </div>
      )}
    </div>
  );
}
