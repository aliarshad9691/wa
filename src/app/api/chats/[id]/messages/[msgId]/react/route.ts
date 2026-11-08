import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { decodeParam } from "@/lib/params";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const p = await params;
  const { emoji } = (await req.json()) as { emoji: string };
  try {
    await wa.react(decodeParam(p.id), decodeParam(p.msgId), emoji || "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
