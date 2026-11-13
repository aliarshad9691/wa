import "server-only";
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { hiddenChatDenied } from "@/lib/hidden";

/** Defence in depth: every API route re-checks the session (the proxy also does). */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    return { user: null, deny: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { user: session.user, deny: null } as const;
}

/** requireUser, plus: hidden (filtered) chats need the unlock from typing the secret code. */
export async function requireChat(chatId: string) {
  const r = await requireUser();
  if (r.deny) return r;
  const deny = await hiddenChatDenied(chatId, r.user.email);
  return deny ? ({ user: null, deny } as const) : r;
}
