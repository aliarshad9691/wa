import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export async function POST(req: Request) {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  const body = (await req.json().catch(() => ({}))) as { pairingPhone?: string };
  await acct.wa.start({ pairingPhone: body.pairingPhone });
  return NextResponse.json({ state: acct.wa.state });
}
