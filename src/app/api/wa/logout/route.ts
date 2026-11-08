import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";

export async function POST() {
  const { deny } = await requireUser();
  if (deny) return deny;
  await wa.logout();
  return NextResponse.json({ state: wa.state });
}
