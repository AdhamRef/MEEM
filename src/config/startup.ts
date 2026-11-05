import { getEnv, InvalidEnvironmentError } from "./env";

/**
 * Stops the server on bad configuration. Without this, Next.js logs the error but keeps
 * running and answers every request with a 500, so a process manager or host would see
 * a healthy process.
 */
export function validateEnvironmentOnStartup(): void {
  try {
    getEnv();
  } catch (error) {
    if (!(error instanceof InvalidEnvironmentError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
