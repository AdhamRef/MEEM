/** Runs once when the server starts, so bad configuration fails fast and clearly. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironmentOnStartup } = await import("@/config/startup");
    validateEnvironmentOnStartup();
  }
}
