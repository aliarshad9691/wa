"use client";

/**
 * Which WhatsApp account this page shows. Every API call names it, so a second tab open on another
 * account (or a switch in another tab) can never make this page read from or send as the wrong number.
 *  - fetch("/api/..."): header x-wa-account (added by the patched fetch below)
 *  - EventSource, <img>, <video>, download links: ?a=<id> (see withAccount)
 */
export interface AccountSummary {
  id: string;
  label: string;
  phone: string | null;
  status: "disconnected" | "connecting" | "qr" | "open";
  unread: number;
}

let current: string | null = null;
let patched = false;

/** Endpoints that are not about one account. */
const UNSCOPED = /^\/api\/(accounts|auth)(\/|\?|$)/;

/** Set the page's account (idempotent; called while ChatApp renders, before any child fetches). */
export function setAccountScope(id: string) {
  // Browser only: on the server this module is shared by every request.
  if (typeof window === "undefined") return;
  current = id;
  if (patched) return;
  patched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith("/") ? url : url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : null;
    if (!current || !path?.startsWith("/api/") || UNSCOPED.test(path)) return orig(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-wa-account", current);
    const res = await orig(input, { ...init, headers });
    // The account was removed (in another tab): start over on an existing one.
    if (res.status === 409) window.location.replace(window.location.pathname);
    return res;
  };
}

/** Add ?a=<account> to an API URL used where headers can't be set. */
export function withAccount(url: string) {
  if (!current) return url;
  return url + (url.includes("?") ? "&" : "?") + "a=" + encodeURIComponent(current);
}

/** Open another account: everything (chats, settings, live updates) reloads for it. */
export async function switchAccount(id: string) {
  const r = await fetch("/api/accounts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (r.ok) openAccountPage(id);
}

/** Load the app for this account (drops the old account's #chat). */
export function openAccountPage(id: string) {
  window.location.replace(`${window.location.pathname}?a=${encodeURIComponent(id)}`);
}
