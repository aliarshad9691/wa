import { NextResponse } from "next/server";
import { requireChat } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { decodeParam } from "@/lib/params";

export async function GET(_req: Request, { params }: { params: Promise<{ jid: string }> }) {
  const { deny } = await requireChat(decodeParam((await params).jid));
  if (deny) return deny;
  const url = await wa.avatarUrl(decodeParam((await params).jid));
  if (!url) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, max-age=3600" } });
  return NextResponse.redirect(url, { headers: { "Cache-Control": "private, max-age=3600" } });
}
