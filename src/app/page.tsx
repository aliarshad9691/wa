import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ChatApp from "@/components/ChatApp";

export default async function Home() {
  const session = await auth();
  if (!session?.user) {
    console.warn("[auth] home: no session, redirecting to /login");
    redirect("/login");
  }
  return (
    <ChatApp
      user={{ name: session.user.name || null, email: session.user.email || null, image: session.user.image || null }}
    />
  );
}
