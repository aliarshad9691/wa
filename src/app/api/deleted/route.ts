import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listDeleted } from "@/lib/wa/repo";

export async function GET() {
  const { deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json({ messages: listDeleted(300) });
}
