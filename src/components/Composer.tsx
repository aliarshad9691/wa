"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Headphones, Image as ImageIcon, LoaderCircle, Mic, Paperclip, Plus, Send, Trash, X } from "lucide-react";
import type { Message } from "./types";
import { formatBytes, formatDuration, previewText } from "./util";

const EMOJIS =
  "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😔 😢 😭 😤 😡 🤯 😳 🥺 😱 🤔 🤫 🙄 😴 🤤 😷 🤒 👍 👎 👏 🙌 🙏 💪 👋 🤝 ✌️ 🤞 👌 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 🔥 ✨ 🎉 🎂 🎁 ☕ 🍕 ⚽ 🚗 ✈️ 🌙 ⭐ ☀️ 🌧️ ✅ ❌ ⚠️ 📌 📷 🎵".split(
    " ",
  );

type Pending = { file: File; mode: "media" | "document"; url: string | null };

export default function Composer({
  chatId,
  disabled,
  replyTo,
  onCancelReply,
  onSent,
  onError,
}: {
  chatId: string;
  disabled: boolean;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : localStorage.getItem("draft:" + chatId) || "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [caption, setCaption] = useState("");
  const [recording, setRecording] = useState<{ started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  // draft per chat (the composer is remounted per chat)
  useEffect(() => {
    try {
      if (text) localStorage.setItem("draft:" + chatId, text);
      else localStorage.removeItem("draft:" + chatId);
    } catch {}
  }, [chatId, text]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  useEffect(() => {
    if (replyTo) textRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - recording.started) / 1000), 200);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  async function post(form: FormData) {
    if (replyTo) form.set("quotedId", replyTo.id);
    setSending(true);
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/send`, { method: "POST", body: form });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Send failed");
      onSent();
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const t = text.trim();
    if (!t || sending) return;
    const form = new FormData();
    form.set("text", t);
    setText("");
    const ok = await post(form);
    if (!ok) setText(t);
    textRef.current?.focus();
  }

  function pick(file: File | undefined, mode: Pending["mode"]) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      onError(`"${file.name}" is ${formatBytes(file.size)}. The limit is 100 MB.`);
      setAttachOpen(false);
      return;
    }
    const previewable = mode === "media" && (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/"));
    setPending({ file, mode, url: previewable ? URL.createObjectURL(file) : null });
    setCaption(text);
    setAttachOpen(false);
  }

  async function sendPending() {
    if (!pending) return;
    const form = new FormData();
    form.set("file", pending.file);
    form.set("mode", pending.mode);
    if (caption.trim()) form.set("text", caption.trim());
    const ok = await post(form);
    if (ok) {
      if (pending.url) URL.revokeObjectURL(pending.url);
      setPending(null);
      setCaption("");
      setText("");
    }
  }

  async function startRecording() {
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      discard.current = false;
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        setElapsed(0);
        if (discard.current || !chunks.current.length) return;
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        const form = new FormData();
        form.set("file", new File([blob], "voice." + (blob.type.includes("mp4") ? "m4a" : "webm"), { type: blob.type }));
        form.set("mode", "voice");
        await post(form);
      };
      rec.start(250);
      recorder.current = rec;
      setRecording({ started: Date.now() });
    } catch {
      onError("Microphone access was denied.");
    }
  }

  function stopRecording(send: boolean) {
    discard.current = !send;
    recorder.current?.stop();
    recorder.current = null;
  }

  if (disabled) {
    return (
      <footer className="flex min-h-[62px] shrink-0 items-center justify-center bg-panel-header px-4 text-[14px] text-muted">
        Link your phone in Settings to send messages. Archived messages are still available.
      </footer>
    );
  }

  return (
    <>
      {/* attachment preview */}
      {pending && (
        <div className="absolute inset-0 z-30 flex flex-col bg-panel-header">
          <div className="flex h-[59px] items-center gap-4 px-4">
            <button onClick={() => setPending(null)} className="text-muted" title="Cancel">
              <X size={24} />
            </button>
            <span className="truncate text-fg">{pending.file.name}</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {pending.url && pending.file.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pending.url} alt="" className="max-h-full max-w-full rounded-md object-contain shadow" />
            ) : pending.url && pending.file.type.startsWith("video/") ? (
              <video src={pending.url} controls className="max-h-full max-w-full rounded-md" />
            ) : pending.url && pending.file.type.startsWith("audio/") ? (
              <audio src={pending.url} controls />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-panel p-10 text-center shadow">
                <FileText size={64} className="text-muted" />
                <div className="max-w-xs truncate text-fg">{pending.file.name}</div>
                <div className="text-[13px] text-muted">
                  {formatBytes(pending.file.size)} · {pending.file.type || "file"}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-6 py-4">
            {!pending.file.type.startsWith("audio/") || pending.mode === "document" ? (
              <input
                autoFocus
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void sendPending()}
                placeholder="Add a caption"
                className="h-11 flex-1 rounded-lg bg-input px-4 text-fg outline-none"
              />
            ) : (
              <div className="flex-1" />
            )}
            <button
              onClick={() => void sendPending()}
              disabled={sending}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow disabled:opacity-60"
              title="Send"
            >
              {sending ? <LoaderCircle className="animate-spin" /> : <Send size={22} />}
            </button>
          </div>
        </div>
      )}

      {replyTo && (
        <div className="flex shrink-0 items-center gap-3 bg-panel-header px-4 pt-2">
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-md bg-quote">
            <span className="w-1 shrink-0 bg-accent" />
            <div className="min-w-0 px-3 py-2">
              <div className="text-[13px] font-medium text-accent">{replyTo.fromMe ? "You" : replyTo.senderName}</div>
              <div className="truncate text-[13px] text-muted">{previewText(replyTo.type, replyTo.text)}</div>
            </div>
          </div>
          <button onClick={onCancelReply} className="text-muted" title="Cancel reply">
            <X size={22} />
          </button>
        </div>
      )}

      <footer className="relative flex min-h-[62px] shrink-0 items-end gap-1 bg-panel-header px-2 py-[9px] sm:gap-2 sm:px-4">
        {emojiOpen && (
          <div className="absolute bottom-full left-0 z-20 grid w-full grid-cols-10 gap-1 border-t border-line bg-panel p-3 text-2xl sm:grid-cols-[repeat(16,minmax(0,1fr))]">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  setText((t) => t + e);
                  textRef.current?.focus();
                }}
                className="rounded p-1 hover:bg-panel-hover"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {recording ? (
          <div className="flex h-11 flex-1 items-center justify-end gap-4">
            <button onClick={() => stopRecording(false)} className="text-muted hover:text-deleted-fg" title="Discard">
              <Trash size={22} />
            </button>
            <span className="relative h-3 w-3 rounded-full bg-[#f15c6d] rec-dot" />
            <span className="w-14 font-mono text-[15px] text-fg">{formatDuration(elapsed)}</span>
            <button
              onClick={() => stopRecording(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white"
              title="Send voice message"
            >
              <Send size={20} />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => {
                setEmojiOpen((v) => !v);
                setAttachOpen(false);
              }}
              className={`flex h-11 w-10 items-center justify-center text-[22px] ${emojiOpen ? "" : "opacity-70 grayscale"}`}
              title="Emoji"
            >
              🙂
            </button>
            <div className="relative">
              <button
                onClick={() => {
                  setAttachOpen((v) => !v);
                  setEmojiOpen(false);
                }}
                className={`flex h-11 w-10 items-center justify-center text-muted transition ${attachOpen ? "rotate-45" : ""}`}
                title="Attach"
              >
                {attachOpen ? <Plus size={26} /> : <Paperclip size={22} />}
              </button>
              {attachOpen && (
                <div className="absolute bottom-14 left-0 z-20 w-56 rounded-xl bg-panel py-2 shadow-xl">
                  <AttachItem icon={<FileText size={20} />} color="#7f66ff" label="Document" onClick={() => docInput.current?.click()} />
                  <AttachItem icon={<ImageIcon size={20} />} color="#007bfc" label="Photos & videos" onClick={() => mediaInput.current?.click()} />
                  <AttachItem icon={<Headphones size={20} />} color="#ff2e74" label="Audio" onClick={() => audioInput.current?.click()} />
                </div>
              )}
            </div>
            <input ref={mediaInput} type="file" accept="image/*,video/*" hidden onChange={(e) => (pick(e.target.files?.[0], "media"), (e.target.value = ""))} />
            <input ref={docInput} type="file" hidden onChange={(e) => (pick(e.target.files?.[0], "document"), (e.target.value = ""))} />
            <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => (pick(e.target.files?.[0], "media"), (e.target.value = ""))} />

            <div className="flex min-h-11 flex-1 items-center rounded-lg bg-input px-3 py-[9px]">
              <textarea
                ref={textRef}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  const f = e.clipboardData.files?.[0];
                  if (f) {
                    e.preventDefault();
                    pick(f, f.type.startsWith("image/") || f.type.startsWith("video/") ? "media" : "document");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void sendText();
                  }
                }}
                placeholder="Type a message"
                className="max-h-[140px] w-full resize-none bg-transparent text-[15px] leading-[20px] text-fg outline-none placeholder:text-muted"
              />
            </div>
            {text.trim() ? (
              <button onClick={() => void sendText()} disabled={sending} className="flex h-11 w-11 items-center justify-center text-muted" title="Send">
                {sending ? <LoaderCircle className="animate-spin" size={22} /> : <Send size={22} />}
              </button>
            ) : sending ? (
              <span className="flex h-11 w-11 items-center justify-center text-muted">
                <LoaderCircle className="animate-spin" size={22} />
              </span>
            ) : (
              <button onClick={() => void startRecording()} className="flex h-11 w-11 items-center justify-center text-muted" title="Record voice message">
                <Mic size={22} />
              </button>
            )}
          </>
        )}
      </footer>
    </>
  );
}

function AttachItem({ icon, color, label, onClick }: { icon: React.ReactNode; color: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 px-4 py-2.5 text-left text-[15px] text-fg hover:bg-panel-hover">
      <span style={{ color }}>{icon}</span>
      {label}
    </button>
  );
}

