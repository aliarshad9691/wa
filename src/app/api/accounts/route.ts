import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE, requireLogin } from "@/lib/session";
import { revokeUnlock } from "@/lib/hidden";
import { accountExists, createAccount, listAccounts, removeAccount, summarize } from "@/lib/accounts";

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

function list() {
  return { accounts: listAccounts().map(summarize) };
}

/** WhatsApp accounts (linked numbers) under this login, for the account switcher. */
export async function GET() {
  const { deny } = await requireLogin();
  if (deny) return deny;
  return NextResponse.json(list());
}

/** Add an account and open it; its Settings then shows a QR code to link another number. */
export async function POST() {
  const { deny } = await requireLogin();
  if (deny) return deny;
  const a = createAccount();
  const res = NextResponse.json({ id: a.id, ...list() });
  res.cookies.set(ACCOUNT_COOKIE, a.id, cookieOpts);
  revokeUnlock(res);
  return res;
}

/** Switch the browser to another account: { id }. The page reloads after this. */
export async function PUT(req: Request) {
  const { deny } = await requireLogin();
  if (deny) return deny;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!accountExists(id)) return NextResponse.json({ error: "account not found" }, { status: 404 });
  const res = NextResponse.json({ id });
  res.cookies.set(ACCOUNT_COOKIE, id, cookieOpts);
  revokeUnlock(res); // hidden chats lock again on every switch
  return res;
}

/** Unlink and remove an account (?id=). Its data is set aside on the server, not deleted. */
export async function DELETE(req: Request) {
  const { deny } = await requireLogin();
  if (deny) return deny;
  const id = new URL(req.url).searchParams.get("id") || "";
  try {
    await removeAccount(id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const res = NextResponse.json(list());
  if ((await cookies()).get(ACCOUNT_COOKIE)?.value === id) {
    res.cookies.set(ACCOUNT_COOKIE, "", { ...cookieOpts, maxAge: 0 });
    revokeUnlock(res);
  }
  return res;
}
