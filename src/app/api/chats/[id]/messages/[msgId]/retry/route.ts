import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { decodeParam } from "@/lib/params";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const p = await params;
  const ok = wa.retryMedia(decodeParam(p.id), decodeParam(p.msgId));
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
