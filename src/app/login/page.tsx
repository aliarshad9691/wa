import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth, googleConfigured, signIn } from "@/auth";

const ERRORS: Record<string, string> = {
  AccessDenied: "That account is not allowed to use this app.",
  Configuration: "Sign-in is not configured correctly on the server.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" && sp.callbackUrl.startsWith("/") ? sp.callbackUrl : "/";
  if (session?.user) redirect(callbackUrl);
  {
    const names = (await cookies()).getAll().map((c) => c.name);
    console.warn("[auth] login page shown", {
      sessionCookie: names.filter((n) => n.includes("session-token")),
      referer: (await headers()).get("referer"),
      error: sp.error ?? null,
    });
  }
  const error = typeof sp.error === "string" ? ERRORS[sp.error] || "Sign-in failed." : null;

  async function google() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl });
  }

  return (
    <main className="relative flex h-full flex-col items-center justify-center overflow-auto px-4">
      <div className="absolute inset-x-0 top-0 h-56 bg-accent-strong" />
      <div className="relative w-full max-w-md rounded-lg bg-panel p-8 shadow-xl sm:p-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
              <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-medium text-fg">Project Alpha</h1>
            <p className="text-sm text-muted">Sign in to see your chats</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-deleted-border bg-deleted px-3 py-2 text-sm text-deleted-fg">{error}</div>
        )}

        {googleConfigured && (
          <form action={google}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-panel px-4 py-2.5 font-medium text-fg transition hover:bg-panel-hover"
            >
              <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </button>
          </form>
        )}

        {!googleConfigured && (
          <p className="text-sm text-muted">
            No sign-in method is configured. Set <code>AUTH_GOOGLE_ID</code> / <code>AUTH_GOOGLE_SECRET</code> (and{" "}
            <code>ALLOWED_EMAILS</code>) in <code>.env.local</code>.
          </p>
        )}

        <p className="mt-6 flex items-center gap-2 text-xs text-muted">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Private instance — only allowed accounts can sign in.
        </p>
      </div>
    </main>
  );
}
