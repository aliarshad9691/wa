import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { hasHistory } from "@/lib/hidden";
import { HIDDEN_VIEW_TTL_S } from "@/lib/wa/repo";
import { decodeParam } from "@/lib/params";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, acct, deny } = await requireChat(decodeParam((await params).id));
  if (deny) return deny;
  const id = decodeParam((await params).id);
  const url = new URL(req.url);
  const before = Number(url.searchParams.get("before")) || undefined;
  const after = Number(url.searchParams.get("after")) || undefined;
  const limit = Number(url.searchParams.get("limit")) || 50;
  const onlyDeleted = url.searchParams.get("deleted") === "1";
  // Hidden chats: messages viewed more than HIDDEN_VIEW_TTL_S ago are left out (kept in the DB).
  const hidden = acct.repo.isHiddenChat(id);
  const revealAll = hidden && (await hasHistory(user?.email, acct.id, id)); // secret typed into this chat
  const messages = acct.repo.listMessages(id, { before, after, limit, onlyDeleted, hideViewed: hidden && !revealAll });
  const pending = messages.filter((m) => m.media?.status === "pending").map((m) => m.id);
  if (pending.length) acct.wa.prioritizeMedia(id, pending);
  return NextResponse.json({ messages, hasMore: messages.length >= limit, disappearAfterViewS: hidden ? HIDDEN_VIEW_TTL_S : null, revealAll });
}
