"use client";
import { Lock, Smartphone } from "lucide-react";
import type { WAState } from "./types";

export default function EmptyPane({ wa, onSettings }: { wa: WAState; onSettings: () => void }) {
  const linked = wa.status === "open" || wa.me;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center border-b-[6px] border-accent bg-panel-header px-8 text-center">
      <div className="mb-8 flex h-40 w-40 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Smartphone size={72} strokeWidth={1.2} />
      </div>
      <h2 className="text-[32px] font-light text-fg-2">Chat Mirror</h2>
      <p className="mt-4 max-w-md text-sm leading-6 text-muted">
        {linked
          ? "Send and receive messages from your linked phone. Every message — including ones deleted for everyone — is archived here."
          : "Link your phone to start mirroring your chats. Messages are stored in SQLite and media in S3."}
      </p>
      {!linked && (
        <button onClick={onSettings} className="mt-6 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-strong">
          Link a phone
        </button>
      )}
      <p className="mt-auto flex items-center gap-1.5 pb-10 text-xs text-muted">
        <Lock size={12} /> Self-hosted. Your messages stay on your server.
      </p>
    </div>
  );
}
