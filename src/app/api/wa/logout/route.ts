import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export async function POST() {
  const { acct, deny } = await requireUser();
  if (deny) return deny;
  await acct.wa.logout();
  return NextResponse.json({ state: acct.wa.state });
}
