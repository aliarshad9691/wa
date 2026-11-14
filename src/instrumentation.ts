export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootAccounts } = await import("./lib/accounts");
    bootAccounts();
  }
}
