"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Database, HardDrive, LoaderCircle, LogOut, RefreshCw, Smartphone } from "lucide-react";
import FilteredNumbers from "./FilteredNumbers";
import AlertSettings from "./AlertSettings";
import Avatar from "./Avatar";
import type { SessionUser, WAState } from "./types";
import { phoneOf } from "./util";
import { signOutAction } from "@/app/actions";

interface StorageInfo {
  backend: "s3" | "local";
  ok: boolean;
  error?: string;
  bucket?: string;
}

export default function SettingsPanel({ user, wa, onBack }: { user: SessionUser; wa: WAState; onBack: () => void }) {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneMode, setPhoneMode] = useState(false);
  const [phone, setPhone] = useState("");
  const started = useRef(false);

  useEffect(() => {
    fetch("/api/wa/state")
      .then((r) => r.json())
      .then((d: { storage: StorageInfo }) => setStorage(d.storage))
      .catch(() => undefined);
  }, []);

  // Opening settings while unlinked starts the pairing flow (QR code).
  useEffect(() => {
    if (!started.current && wa.status === "disconnected") {
      started.current = true;
      void connect();
    }
  }, [wa.status]);

  async function connect(pairingPhone?: string) {
    setBusy(true);
    try {
      await fetch("/api/wa/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingPhone }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function logoutPhone() {
    if (!confirm("Unlink this phone? Archived messages stay in the database.")) return;
    setBusy(true);
    try {
      await fetch("/api/wa/logout", { method: "POST" });
    } finally {
      setBusy(false);
      started.current = true; // don't immediately start a new QR
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <header className="flex h-[108px] shrink-0 items-end bg-accent-strong px-6 pb-4 text-white dark:bg-panel-header">
        <div className="flex items-center gap-6">
          <button onClick={onBack} title="Back" className="rounded-full">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-[19px] font-medium">Settings</h1>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* Profile */}
        <section className="flex items-center gap-4 px-6 py-5">
          <Avatar src={user.image} size={72} />
          <div className="min-w-0">
            <div className="truncate text-[17px] text-fg">{user.name || user.email}</div>
            <div className="truncate text-[14px] text-muted">{user.email}</div>
          </div>
        </section>

        {/* Linked phone */}
        <Section icon={<Smartphone size={20} />} title="Linked phone">
          {wa.status === "open" && wa.me ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar id={wa.me.id} size={44} />
                <div>
                  <div className="text-fg">{wa.me.name || "Your phone"}</div>
                  <div className="text-[13px] text-muted">{phoneOf(wa.me.id)}</div>
                </div>
                <span className="ml-auto rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">Connected</span>
              </div>
              <button
                onClick={logoutPhone}
                disabled={busy}
                className="flex items-center gap-2 rounded-full border border-deleted-border px-4 py-2 text-[14px] text-deleted-fg hover:bg-deleted disabled:opacity-50"
              >
                <LogOut size={16} /> Unlink phone
              </button>
            </div>
          ) : wa.status === "qr" ? (
            <div>
              <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[14px] leading-6 text-fg-2">
                <li>Open WhatsApp on your phone</li>
                <li>
                  Tap <b>Menu</b> or <b>Settings</b> and select <b>Linked devices</b>
                </li>
                <li>
                  Tap <b>Link a device</b> and point your phone at this screen
                </li>
              </ol>
              {wa.pairingCode ? (
                <div className="rounded-lg border border-line p-4 text-center">
                  <div className="text-[13px] text-muted">Enter this code on your phone</div>
                  <div className="mt-2 font-mono text-3xl tracking-[0.3em] text-fg">
                    {wa.pairingCode.slice(0, 4)}-{wa.pairingCode.slice(4)}
                  </div>
                </div>
              ) : phoneMode ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (phone.replace(/\D/g, "").length >= 8) void connect(phone);
                  }}
                  className="space-y-3"
                >
                  <label className="block text-[13px] text-muted">Phone number with country code</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 123 4567"
                    className="w-full rounded-md border border-line bg-input px-3 py-2 text-fg outline-none focus:border-accent"
                  />
                  <button disabled={busy} className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50">
                    Get code
                  </button>
                </form>
              ) : (
                wa.qr && (
                  <div className="flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={wa.qr} alt="QR code to link your phone" className="h-[264px] w-[264px] rounded-md bg-white p-2" />
                  </div>
                )
              )}
              <button onClick={() => setPhoneMode((v) => !v)} className="mt-4 text-[14px] text-accent hover:underline">
                {phoneMode ? "Link with QR code instead" : "Link with phone number instead"}
              </button>
            </div>
          ) : wa.status === "connecting" || busy ? (
            <div className="flex items-center gap-3 py-6 text-muted">
              <LoaderCircle className="animate-spin" size={20} /> Connecting…
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[14px] text-muted">{wa.lastError ? `${wa.lastError}.` : "No phone linked."}</p>
              <button
                onClick={() => connect()}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white hover:bg-accent-strong"
              >
                <RefreshCw size={16} /> Generate QR code
              </button>
            </div>
          )}
        </Section>

        <FilteredNumbers />
        <AlertSettings />

        {/* Sync */}
        <Section icon={<Database size={20} />} title="Message archive (SQLite)">
          <dl className="grid grid-cols-2 gap-y-2 text-[14px]">
            <dt className="text-muted">History sync</dt>
            <dd className="text-right text-fg">
              {wa.sync.active ? `In progress${wa.sync.progress != null ? ` · ${wa.sync.progress}%` : ""}` : wa.sync.lastAt ? "Up to date" : "—"}
            </dd>
            <dt className="text-muted">Synced this session</dt>
            <dd className="text-right text-fg">
              {wa.sync.chats.toLocaleString()} chats · {wa.sync.messages.toLocaleString()} msgs
            </dd>
            <dt className="text-muted">Last sync</dt>
            <dd className="text-right text-fg">{wa.sync.lastAt ? new Date(wa.sync.lastAt).toLocaleString() : "—"}</dd>
            <dt className="text-muted">Deleted messages</dt>
            <dd className="text-right text-fg">Always kept</dd>
          </dl>
        </Section>

        <Section icon={<HardDrive size={20} />} title="Media storage">
          <dl className="grid grid-cols-2 gap-y-2 text-[14px]">
            <dt className="text-muted">Backend</dt>
            <dd className="text-right text-fg">
              {storage ? (storage.backend === "s3" ? `S3 · ${storage.bucket}` : "Local disk (S3 not configured)") : "…"}
            </dd>
            <dt className="text-muted">Status</dt>
            <dd className={`text-right ${storage && !storage.ok ? "text-deleted-fg" : "text-fg"}`}>
              {storage ? (storage.ok ? "OK" : storage.error) : "…"}
            </dd>
            <dt className="text-muted">Download queue</dt>
            <dd className="text-right text-fg">
              {wa.media.active} active · {wa.media.queued} queued
            </dd>
            <dt className="text-muted">Failed</dt>
            <dd className="text-right text-fg">{wa.media.failed}</dd>
          </dl>
        </Section>

        <form action={signOutAction} className="px-6 py-6">
          <button className="flex items-center gap-3 text-[15px] text-deleted-fg hover:underline">
            <LogOut size={18} /> Sign out of Project Alpha
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t-8 border-panel-header px-6 py-5">
      <h2 className="mb-4 flex items-center gap-3 text-[15px] font-medium text-accent">
        <span className="text-muted">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
