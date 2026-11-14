import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { decodeParam } from "@/lib/params";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { acct, deny } = await requireChat(decodeParam((await params).id));
  if (deny) return deny;
  await acct.wa.markRead(decodeParam((await params).id));
  return NextResponse.json({ ok: true });
}
