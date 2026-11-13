import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { grantUnlock, revokeHistory, revokeUnlock } from "@/lib/hidden";
import { listChats } from "@/lib/wa/repo";

/**
 * Filtered numbers' chats are hidden from the sidebar. They are returned here only when the
 * search text equals HIDDEN_CHATS_CODE (checked on the server, so the code never reaches the page).
 * A match also sets the unlock cookie that the chat APIs require for those chats.
 */
export async function GET(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const code = process.env.HIDDEN_CHATS_CODE?.trim();
  const q = new URL(req.url).searchParams.get("code")?.trim();
  if (!code || q !== code || !user.email) return NextResponse.json({ chats: [] });
  const res = NextResponse.json({ chats: listChats({ hidden: true }) });
  grantUnlock(res, user.email);
  return res;
}

/**
 * Lock the hidden chats again (page load, search cleared, hidden chat closed).
 * ?scope=history only ends the full-history view of a chat (closed after typing the secret in it).
 */
export async function DELETE(req: Request) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const res = NextResponse.json({ ok: true });
  if (new URL(req.url).searchParams.get("scope") === "history") revokeHistory(res);
  else revokeUnlock(res);
  return res;
}
