import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { phoneToJid } from "@/lib/wa/repo";

/** Settings > Alerts: who to message when a hidden (filtered) number writes, and what to say. */
export async function GET() {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(acct.repo.getAlertSettings());
}

export async function PUT(req: Request) {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  const body = (await req.json().catch(() => ({}))) as { phone?: string; text?: string; cooldownMin?: number };
  const rawPhone = String(body.phone || "").trim();
  const phone = rawPhone ? phoneToJid(rawPhone) : null;
  if (rawPhone && !phone) return NextResponse.json({ error: "Enter a full phone number with country code." }, { status: 400 });
  const text = String(body.text || "").trim().slice(0, 200);
  const cooldownMin = Math.min(1440, Math.max(0, Math.round(Number(body.cooldownMin) || 0)));
  acct.repo.setAlertSettings({ phone, text, cooldownMin });
  return NextResponse.json(acct.repo.getAlertSettings());
}

/** Send the alert text to the alert number now. */
export async function POST() {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  try {
    await acct.wa.sendTestAlert();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
