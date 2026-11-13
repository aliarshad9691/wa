import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { listMessages } from "@/lib/wa/repo";
import { wa } from "@/lib/wa/manager";
import { decodeParam } from "@/lib/params";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireChat(decodeParam((await params).id));
  if (deny) return deny;
  const id = decodeParam((await params).id);
  const url = new URL(req.url);
  const before = Number(url.searchParams.get("before")) || undefined;
  const after = Number(url.searchParams.get("after")) || undefined;
  const limit = Number(url.searchParams.get("limit")) || 50;
  const onlyDeleted = url.searchParams.get("deleted") === "1";
  const messages = listMessages(id, { before, after, limit, onlyDeleted });
  const pending = messages.filter((m) => m.media?.status === "pending").map((m) => m.id);
  if (pending.length) wa.prioritizeMedia(id, pending);
  return NextResponse.json({ messages, hasMore: messages.length >= limit });
}
