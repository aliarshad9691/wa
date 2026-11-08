import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowed = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email?: string | null) {
  if (!email) return false;
  // If no allow-list is configured, nobody gets in: this app exposes a WhatsApp account.
  return allowed.includes(email.toLowerCase());
}

export const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

// Browsers share cookies across every port on a host, so any other Auth.js app on localhost (or the
// same domain) would use the same default "authjs.*" names and keep clobbering our session.
// Give every Auth.js cookie a name unique to this app.
const secureCookies = process.env.NODE_ENV === "production";
const cookiePrefix = (secureCookies ? "__Secure-" : "") + "wamirror.";
const cookie = (name: string, extra: { maxAge?: number } = {}) => ({
  name: `${cookiePrefix}${name}`,
  options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: secureCookies, ...extra },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: googleConfigured ? [Google] : [],
  cookies: {
    sessionToken: cookie("session-token"),
    callbackUrl: cookie("callback-url"),
    csrfToken: {
      ...cookie("csrf-token"),
      name: (secureCookies ? "__Host-" : "") + "wamirror.csrf-token",
    },
    pkceCodeVerifier: cookie("pkce.code_verifier", { maxAge: 60 * 15 }),
    state: cookie("state", { maxAge: 60 * 15 }),
    nonce: cookie("nonce"),
  },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ user, account }) {
      return account?.provider === "google" && isEmailAllowed(user.email);
    },
    // Re-checked on every request: ends any session that isn't an allowed Google account
    // (including sessions issued before a provider was removed or an email was un-listed).
    jwt({ token, trigger }) {
      if (isEmailAllowed(token.email)) return token;
      console.warn("[auth] session rejected", { trigger, hasEmail: Boolean(token.email), keys: Object.keys(token) });
      return null;
    },
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
});
