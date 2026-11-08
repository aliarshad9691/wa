export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootWhatsApp } = await import("./lib/wa/manager");
    bootWhatsApp();
  }
}
