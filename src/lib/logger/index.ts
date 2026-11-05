/**
 * Structured server logging. One JSON object per line keeps logs searchable on any host,
 * with no logging service or dependency. Secrets are removed before anything is written.
 */
type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const SECRET_KEY = /secret|token|password|api[-_]?key|authorization|cookie|database[-_]?url/i;
const REDACTED = "[redacted]";

/** Hides credentials in connection strings and YouTube API keys in request URLs. */
function redactString(value: string): string {
  return value
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${REDACTED}@`)
    .replace(/([?&]key=)[^&\s]+/g, `$1${REDACTED}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    // Stack traces stay in server logs and never reach users. See toPublicError.
    return { name: value.name, message: redactString(value.message), stack: value.stack && redactString(value.stack) };
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth >= 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1)]),
  );
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  const entry = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message: redactString(message),
    ...(context ? { context: redact(context) } : {}),
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
