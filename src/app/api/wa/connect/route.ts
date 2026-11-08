import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";

export async function POST(req: Request) {
  const { deny } = await requireUser();
  if (deny) return deny;
  const body = (await req.json().catch(() => ({}))) as { pairingPhone?: string };
  await wa.start({ pairingPhone: body.pairingPhone });
  return NextResponse.json({ state: wa.state });
}
