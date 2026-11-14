import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { decodeParam } from "@/lib/params";

/** Current state of the switch. Read per chat: hidden chats are not in the chat list. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { acct, deny } = await requireChat(decodeParam((await params).id));
  if (deny) return deny;
  return NextResponse.json({ enabled: Boolean(acct.repo.getChat(decodeParam((await params).id))?.read_receipts) });
}

/** Per-chat read receipts switch: { enabled: boolean }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { acct, deny } = await requireChat(decodeParam((await params).id));
  if (deny) return deny;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  await acct.wa.setReadReceipts(decodeParam((await params).id), body.enabled);
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
