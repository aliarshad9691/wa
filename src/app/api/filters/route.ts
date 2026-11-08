import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { addFiltered, listFiltered, phoneToJid, removeFiltered } from "@/lib/wa/repo";

/** Numbers whose calls are auto-rejected and whose new messages are archived then removed from the phone. */
export async function GET() {
  const { deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ numbers: listFiltered() });
}

export async function POST(req: Request) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const body = (await req.json().catch(() => ({}))) as { phone?: string; label?: string };
  const pn = phoneToJid(String(body.phone || ""));
  if (!pn) return NextResponse.json({ error: "Enter a full phone number with country code." }, { status: 400 });
  addFiltered(pn, body.label?.trim() || null);
  wa.reloadFiltered();
  return NextResponse.json({ numbers: listFiltered() });
}

export async function DELETE(req: Request) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const pn = new URL(req.url).searchParams.get("pn") || "";
  removeFiltered(pn);
  wa.reloadFiltered();
  return NextResponse.json({ numbers: listFiltered() });
}
