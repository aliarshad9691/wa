"use client";
import { useState } from "react";
import { LoaderCircle, Plus, Smartphone } from "lucide-react";
import { openAccountPage, switchAccount, type AccountSummary } from "./account";

const STATUS: Record<AccountSummary["status"], { dot: string; text: string }> = {
  open: { dot: "bg-accent", text: "Connected" },
  connecting: { dot: "bg-amber-400", text: "Connecting" },
  qr: { dot: "bg-amber-400", text: "Waiting for QR scan" },
  disconnected: { dot: "bg-[#8696a0]", text: "Not linked" },
};

/** Two letters for the bubble: initials of the name, or the last digits of the number. */
function initials(a: AccountSummary) {
  if (a.label !== a.phone && a.label !== "New account") {
    const parts = a.label.trim().split(/\s+/).filter(Boolean);
    const s = (parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || "");
    if (s.trim()) return s.toUpperCase();
  }
  if (a.phone) return a.phone.replace(/\D/g, "").slice(-2);
  return null; // never linked: shown as a phone icon
}

/** Stable color per account, so each number is recognisable at a glance. */
function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/**
 * Account switcher pinned to the right edge: one bubble per linked WhatsApp number, plus "add".
 * Clicking another number reloads the whole app for it.
 */
export default function AccountRail({
  accounts,
  currentId,
  className = "",
}: {
  accounts: AccountSummary[];
  currentId: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function open(id: string) {
    if (id === currentId || busy) return;
    setBusy(id);
    await switchAccount(id).catch(() => undefined);
    setBusy(null);
  }

  async function add() {
    if (busy) return;
    setBusy("new");
    try {
      const r = await fetch("/api/accounts", { method: "POST" });
      if (r.ok) openAccountPage(((await r.json()) as { id: string }).id); // opens its QR screen
    } finally {
      setBusy(null);
    }
  }

  return (
    <nav
      aria-label="WhatsApp accounts"
      className={`flex h-full w-[60px] shrink-0 flex-col items-center gap-3 border-l border-line bg-panel-header py-4 md:w-[68px] ${className}`}
    >
      {accounts.map((a) => {
        const active = a.id === currentId;
        const st = STATUS[a.status];
        const name = a.label === a.phone || !a.phone ? a.label : `${a.label} · ${a.phone}`;
        return (
          <div key={a.id} className="relative flex w-full justify-center">
            {/* active marker, hugging the right edge like a tab */}
            <span
              className={`absolute top-1/2 right-0 w-1 -translate-y-1/2 rounded-l-full bg-accent transition-all ${active ? "h-9" : "h-0"}`}
            />
            <button
              onClick={() => void open(a.id)}
              title={`${name}\n${st.text}${active ? " · open" : ""}`}
              aria-label={`${name}, ${st.text}${active ? ", open" : ""}`}
              aria-current={active ? "true" : undefined}
              className={`relative flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-medium text-white transition ${
                active ? "ring-2 ring-accent ring-offset-2 ring-offset-panel-header" : "opacity-80 hover:opacity-100"
              }`}
              style={{ background: `hsl(${hue(a.id)} 45% 45%)` }}
            >
              {busy === a.id ? <LoaderCircle size={18} className="animate-spin" /> : (initials(a) ?? <Smartphone size={19} />)}
              <span className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-panel-header ${st.dot}`} />
              {a.unread > 0 && !active && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-accent px-1 text-[11px] leading-5 font-semibold text-white">
                  {a.unread > 99 ? "99+" : a.unread}
                </span>
              )}
            </button>
          </div>
        );
      })}

      <button
        onClick={() => void add()}
        title="Add another WhatsApp number"
        aria-label="Add another WhatsApp number"
        className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-muted/60 text-muted transition hover:border-accent hover:text-accent"
      >
        {busy === "new" ? <LoaderCircle size={18} className="animate-spin" /> : <Plus size={20} />}
      </button>
    </nav>
  );
}
