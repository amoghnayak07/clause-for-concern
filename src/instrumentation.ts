/**
 * Runs once when the Next.js server starts. Validating config here makes the
 * server fail fast with a clear message instead of on the first review.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/config");
    getConfig();
  }
}
