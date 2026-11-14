import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hiddenChatDenied } from "@/lib/hidden";
import { MAIN_ACCOUNT, accountExists, getAccount, type Account } from "@/lib/accounts";

/** Remembers which WhatsApp account the browser last opened (used on page load only). */
export const ACCOUNT_COOKIE = (process.env.NODE_ENV === "production" ? "__Host-" : "") + "wamirror.account";
/** Every API call names its account explicitly (fetch header; `?a=` for EventSource/img, see proxy.ts). */
export const ACCOUNT_HEADER = "x-wa-account";

/** Account for the page: the remembered one, or the first account. */
export async function pageAccountId(): Promise<string> {
  const id = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  return accountExists(id) ? id : MAIN_ACCOUNT;
}

/**
 * Account for an API call. A request naming an account that no longer exists is refused (409),
 * so a tab left open on a removed account can't act on another one.
 */
async function requestAccount(): Promise<{ acct: Account; deny: null } | { acct: null; deny: NextResponse }> {
  const named = (await headers()).get(ACCOUNT_HEADER);
  const id = named ?? (await pageAccountId());
  if (!accountExists(id)) {
    return { acct: null, deny: NextResponse.json({ error: "account not found", account: id }, { status: 409 }) };
  }
  return { acct: getAccount(id), deny: null };
}

/** Signed in, without picking an account (the accounts API itself). */
export async function requireLogin() {
  const session = await auth();
  if (!session?.user) return { user: null, deny: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { user: session.user, deny: null } as const;
}

/** Defence in depth: every API route re-checks the session (the proxy also does). */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    return { user: null, acct: null, deny: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  const r = await requestAccount();
  if (r.deny) return { user: null, acct: null, deny: r.deny } as const;
  return { user: session.user, acct: r.acct, deny: null } as const;
}

/** requireUser, plus: hidden (filtered) chats need the unlock from typing the secret code. */
export async function requireChat(chatId: string) {
  const r = await requireUser();
  if (r.deny) return r;
  const deny = await hiddenChatDenied(r.acct, chatId, r.user.email);
  return deny ? ({ user: null, acct: null, deny } as const) : r;
}
