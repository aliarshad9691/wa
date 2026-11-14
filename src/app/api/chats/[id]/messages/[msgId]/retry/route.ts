import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { decodeParam } from "@/lib/params";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const p = await params;
  const { acct, deny } = await requireChat(decodeParam(p.id));
  if (deny) return deny;
  const ok = acct.wa.retryMedia(decodeParam(p.id), decodeParam(p.msgId));
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
