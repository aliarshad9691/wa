import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isHiddenChat } from "@/lib/wa/repo";

/**
 * Hidden (filtered) chats are only reachable after the secret code is typed into search.
 * A correct code sets this short-lived, httpOnly unlock cookie; every chat-scoped API checks it,
 * so a link (/#<chat id>), a reload or browser history can't open a hidden chat on its own.
 * The page clears it on load and once the hidden chats are no longer shown.
 */
const prod = process.env.NODE_ENV === "production";
const NAME = (prod ? "__Host-" : "") + "wamirror.unlock";
const TTL_S = 12 * 60 * 60;
const opts = { httpOnly: true, secure: prod, sameSite: "strict" as const, path: "/" };

function sign(email: string, exp: number, scope = "unlock") {
  // Bound to the session secret and the code: changing either invalidates every unlock.
  const key = `${process.env.AUTH_SECRET || ""}\0${process.env.HIDDEN_CHATS_CODE?.trim() || ""}`;
  return crypto.createHmac("sha256", key).update(scope === "unlock" ? `${email.toLowerCase()}|${exp}` : `${scope}|${email.toLowerCase()}|${exp}`).digest("base64url");
}

export function grantUnlock(res: NextResponse, email: string) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  res.cookies.set(NAME, `${exp}.${sign(email, exp)}`, { ...opts, maxAge: TTL_S });
}

export function revokeUnlock(res: NextResponse) {
  res.cookies.set(NAME, "", { ...opts, maxAge: 0 });
  revokeHistory(res);
}

/** True when `text` is the secret code (so it must never be sent to WhatsApp). */
export function isSecret(text: string) {
  const code = process.env.HIDDEN_CHATS_CODE?.trim();
  if (!code) return false;
  const a = Buffer.from(text.trim());
  const b = Buffer.from(code);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/*
 * Full history of one hidden chat: typing the secret into that chat's message box shows the
 * messages that were hidden after being viewed, until the chat is closed or the page reloads.
 */
const HISTORY = (prod ? "__Host-" : "") + "wamirror.history";
const HISTORY_TTL_S = 30 * 60;

export function grantHistory(res: NextResponse, email: string, chatId: string) {
  const exp = Math.floor(Date.now() / 1000) + HISTORY_TTL_S;
  const id = Buffer.from(chatId).toString("base64url");
  res.cookies.set(HISTORY, `${exp}.${id}.${sign(email, exp, `history:${chatId}`)}`, { ...opts, maxAge: HISTORY_TTL_S });
}

export function revokeHistory(res: NextResponse) {
  res.cookies.set(HISTORY, "", { ...opts, maxAge: 0 });
}

export async function hasHistory(email: string | null | undefined, chatId: string) {
  if (!email || !(await isUnlocked(email))) return false;
  const [expS, id, sig] = ((await cookies()).get(HISTORY)?.value || "").split(".");
  const exp = Number(expS);
  if (!sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  if (Buffer.from(id, "base64url").toString() !== chatId) return false;
  const want = Buffer.from(sign(email, exp, `history:${chatId}`));
  const got = Buffer.from(sig);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function isUnlocked(email: string | null | undefined) {
  if (!email || !process.env.HIDDEN_CHATS_CODE?.trim()) return false;
  const [expS, sig] = ((await cookies()).get(NAME)?.value || "").split(".");
  const exp = Number(expS);
  if (!sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const want = Buffer.from(sign(email, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** 404 (as if the chat didn't exist) for a hidden chat without an unlock; null when allowed. */
export async function hiddenChatDenied(chatId: string, email: string | null | undefined) {
  if (!isHiddenChat(chatId) || (await isUnlocked(email))) return null;
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
