import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ChatApp from "@/components/ChatApp";
import { pageAccountId } from "@/lib/session";
import { accountExists, listAccounts, summarize } from "@/lib/accounts";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) {
    console.warn("[auth] home: no session, redirecting to /login");
    redirect("/login");
  }
  // ?a=<id> right after adding or switching an account (the remembered cookie covers later visits).
  const a = (await searchParams).a;
  const accountId = typeof a === "string" && accountExists(a) ? a : await pageAccountId();
  return (
    <ChatApp
      user={{ name: session.user.name || null, email: session.user.email || null, image: session.user.image || null }}
      accountId={accountId}
      initialAccounts={listAccounts().map(summarize)}
    />
  );
}
