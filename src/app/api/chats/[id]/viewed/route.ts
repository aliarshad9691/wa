import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { isHiddenChat, markViewed } from "@/lib/wa/repo";
import { decodeParam } from "@/lib/params";

/**
 * Hidden chats: the page reports which messages were on screen ({ ids }). Their first-view time
 * is stored, and they stop being shown HIDDEN_VIEW_TTL_S later. Nothing is deleted.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const chatId = decodeParam((await params).id);
  const { deny } = await requireChat(chatId);
  if (deny) return deny;
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (!isHiddenChat(chatId) || !ids.length) return NextResponse.json({ viewed: {} });
  return NextResponse.json({ viewed: markViewed(chatId, ids) });
}
