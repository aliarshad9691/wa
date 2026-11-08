import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { wa } from "@/lib/wa/manager";
import { checkStorage } from "@/lib/storage";

export async function GET() {
  const { deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ state: wa.state, storage: await checkStorage(), hasSession: wa.hasSession() });
}
