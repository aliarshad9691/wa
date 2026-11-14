import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { phoneToJid } from "@/lib/wa/repo";

/** Numbers whose calls are auto-rejected and whose new messages are archived then removed from the phone. */
export async function GET() {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ numbers: acct.repo.listFiltered() });
}

export async function POST(req: Request) {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  const body = (await req.json().catch(() => ({}))) as { phone?: string; label?: string };
  const pn = phoneToJid(String(body.phone || ""));
  if (!pn) return NextResponse.json({ error: "Enter a full phone number with country code." }, { status: 400 });
  acct.repo.addFiltered(pn, body.label?.trim() || null);
  acct.wa.reloadFiltered();
  return NextResponse.json({ numbers: acct.repo.listFiltered() });
}

export async function DELETE(req: Request) {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  const pn = new URL(req.url).searchParams.get("pn") || "";
  acct.repo.removeFiltered(pn);
  acct.wa.reloadFiltered();
  return NextResponse.json({ numbers: acct.repo.listFiltered() });
}
