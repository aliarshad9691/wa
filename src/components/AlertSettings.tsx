"use client";
import { useEffect, useState } from "react";
import { BellRing, LoaderCircle } from "lucide-react";
import { phoneOf } from "./util";

interface Alerts {
  phone: string | null;
  text: string;
  cooldownMin: number;
}

const input =
  "w-full rounded-md border border-line bg-input px-3 py-2 text-[14px] text-fg outline-none focus:border-accent";

/** Settings section: message an alert number when a hidden (filtered) number writes. */
export default function AlertSettings() {
  const [loaded, setLoaded] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [cooldown, setCooldown] = useState("5");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);

  function apply(a: Alerts) {
    setPhone(a.phone ? "+" + phoneOf(a.phone).replace(/^\+/, "") : "");
    setText(a.text);
    setCooldown(String(a.cooldownMin));
    setLoaded(true);
  }

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then(apply)
      .catch(() => setLoaded(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setNote(null);
    try {
      const r = await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, text, cooldownMin: Number(cooldown) }),
      });
      const d = (await r.json()) as Alerts & { error?: string };
      if (!r.ok) throw new Error(d.error || "Could not save");
      apply(d);
      setNote({ ok: true, msg: d.phone ? "Saved" : "Saved. Alerts are off (no number)." });
    } catch (err) {
      setNote({ ok: false, msg: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setNote(null);
    try {
      const r = await fetch("/api/alerts", { method: "POST" });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error || "Could not send");
      setNote({ ok: true, msg: "Test alert sent" });
    } catch (err) {
      setNote({ ok: false, msg: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-t-8 border-panel-header px-6 py-5">
      <h2 className="mb-2 flex items-center gap-3 text-[15px] font-medium text-accent">
        <span className="text-muted">
          <BellRing size={20} />
        </span>
        Alerts
      </h2>
      <p className="mb-4 text-[13px] leading-5 text-muted">
        When a filtered number sends you a message, this text is sent on WhatsApp to the alert number. It never includes
        what they wrote. Leave the number empty to turn alerts off.
      </p>
      {!loaded ? (
        <LoaderCircle size={18} className="animate-spin text-muted" />
      ) : (
        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Alert number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" inputMode="tel" className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Alert message</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">At most one alert every (minutes, 0 = every message)</span>
            <input
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className={`${input} max-w-[120px]`}
            />
          </label>
          <div className="flex items-center gap-3 pt-1">
            <button
              disabled={busy !== null}
              className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {busy === "save" ? <LoaderCircle size={16} className="animate-spin" /> : "Save"}
            </button>
            <button
              type="button"
              onClick={test}
              disabled={busy !== null || !phone.trim()}
              className="rounded-full border border-line px-4 py-2 text-[14px] text-fg hover:bg-panel-hover disabled:opacity-50"
            >
              {busy === "test" ? <LoaderCircle size={16} className="animate-spin" /> : "Send test"}
            </button>
            {note && <span className={`text-[13px] ${note.ok ? "text-accent" : "text-deleted-fg"}`}>{note.msg}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
