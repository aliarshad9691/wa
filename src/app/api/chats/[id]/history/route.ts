import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { decodeParam } from "@/lib/params";

/** Request older messages for a chat from the phone; they arrive asynchronously via history sync. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requireChat(decodeParam((await params).id));
  if (deny) return deny;
  try {
    await wa.fetchOlder(decodeParam((await params).id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
