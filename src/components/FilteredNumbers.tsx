"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, PhoneOff, ShieldBan, X } from "lucide-react";
import { phoneOf } from "./util";

interface FilteredNumber {
  pn: string;
  label: string | null;
  created_at: number;
  removed_count: number;
  calls_rejected: number;
}

/**
 * Settings section: numbers whose calls are rejected automatically and whose new messages are
 * archived here, then deleted from WhatsApp on the phone. Their existing history is untouched.
 */
export default function FilteredNumbers() {
  const [numbers, setNumbers] = useState<FilteredNumber[] | null>(null);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/filters")
        .then((r) => r.json())
        .then((d: { numbers: FilteredNumber[] }) => !cancelled && setNumbers(d.numbers))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 15000); // keep the counters fresh
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, label }),
      });
      const d = (await r.json()) as { numbers?: FilteredNumber[]; error?: string };
      if (!r.ok) throw new Error(d.error || "Could not add number");
      setNumbers(d.numbers || []);
      setPhone("");
      setLabel("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(pn: string) {
    if (!confirm(`Stop filtering ${phoneOf(pn)}? Messages already archived stay in the app.`)) return;
    const r = await fetch(`/api/filters?pn=${encodeURIComponent(pn)}`, { method: "DELETE" });
    if (r.ok) setNumbers(((await r.json()) as { numbers: FilteredNumber[] }).numbers);
  }

  return (
    <section className="border-t-8 border-panel-header px-6 py-5">
      <h2 className="mb-2 flex items-center gap-3 text-[15px] font-medium text-accent">
        <span className="text-muted">
          <ShieldBan size={20} />
        </span>
        Filtered numbers
      </h2>
      <p className="mb-4 text-[13px] leading-5 text-muted">
        Calls from these numbers are rejected immediately. <b>New</b> messages in these chats, theirs and the ones you
        send from this app, are saved here, then deleted for you on WhatsApp so they don&apos;t show on your phone. They still see
        everything. Messages you send from your phone, and anything from before you added the number, are left as they are.
      </p>

      <form onSubmit={add} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+971 50 123 4567"
          inputMode="tel"
          className="min-w-0 flex-1 rounded-md border border-line bg-input px-3 py-2 text-[14px] text-fg outline-none focus:border-accent"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="min-w-0 flex-1 rounded-md border border-line bg-input px-3 py-2 text-[14px] text-fg outline-none focus:border-accent sm:max-w-[160px]"
        />
        <button
          disabled={busy || !phone.trim()}
          className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : "Add"}
        </button>
      </form>
      {error && <p className="mb-3 text-[13px] text-deleted-fg">{error}</p>}

      {numbers === null ? (
        <LoaderCircle size={18} className="animate-spin text-muted" />
      ) : numbers.length === 0 ? (
        <p className="text-[13px] text-muted">No numbers yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {numbers.map((n) => (
            <li key={n.pn} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-fg">
                  {n.label ? `${n.label} · ` : ""}
                  {phoneOf(n.pn)}
                </div>
                <div className="flex items-center gap-3 text-[12px] text-muted">
                  <span>{n.removed_count} removed from phone</span>
                  <span className="flex items-center gap-1">
                    <PhoneOff size={12} /> {n.calls_rejected} calls rejected
                  </span>
                </div>
              </div>
              <button onClick={() => remove(n.pn)} title="Stop filtering" className="rounded-full p-1.5 text-muted hover:bg-panel-hover hover:text-deleted-fg">
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
