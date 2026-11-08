"use client";
import { useState } from "react";
import { Users, User } from "lucide-react";

const failed = new Set<string>();

export default function Avatar({ id, isGroup, size = 49, src }: { id?: string; isGroup?: boolean; size?: number; src?: string | null }) {
  const url = src || (id ? `/api/avatar/${encodeURIComponent(id)}` : null);
  const [broken, setBroken] = useState(() => (url ? failed.has(url) : true));
  const icon = Math.round(size * 0.55);
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full bg-[#dfe5e7] text-white dark:bg-[#6a7175]"
      style={{ width: size, height: size }}
    >
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => {
            failed.add(url);
            setBroken(true);
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#cfd7db] text-white dark:bg-[#53636d]">
          {isGroup ? <Users size={icon} strokeWidth={1.8} /> : <User size={icon} strokeWidth={1.8} />}
        </div>
      )}
    </div>
  );
}
