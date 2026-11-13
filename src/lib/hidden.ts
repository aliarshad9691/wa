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

function sign(email: string, exp: number) {
  // Bound to the session secret and the code: changing either invalidates every unlock.
  const key = `${process.env.AUTH_SECRET || ""}\0${process.env.HIDDEN_CHATS_CODE?.trim() || ""}`;
  return crypto.createHmac("sha256", key).update(`${email.toLowerCase()}|${exp}`).digest("base64url");
}

export function grantUnlock(res: NextResponse, email: string) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  res.cookies.set(NAME, `${exp}.${sign(email, exp)}`, { ...opts, maxAge: TTL_S });
}

export function revokeUnlock(res: NextResponse) {
  res.cookies.set(NAME, "", { ...opts, maxAge: 0 });
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
