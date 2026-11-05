import { z } from "zod";

/** Treats empty strings from .env files as "not set". */
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z
      .string({ error: "is required" })
      .regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
    APP_URL: z.url({ error: "must be a full URL, for example https://example.com" }),

    AUTH_SECRET: optionalString,
    AUTH_GOOGLE_ID: optionalString,
    AUTH_GOOGLE_SECRET: optionalString,
    NEXTAUTH_URL: optionalString,

    YOUTUBE_API_ENABLED: z
      .enum(["true", "false"], { error: 'must be "true" or "false"' })
      .default("false")
      .transform((value) => value === "true"),
    YOUTUBE_API_KEY: optionalString,
    CRON_SECRET: optionalString,

    STORAGE_PROVIDER: z.enum(["local", "s3"], { error: 'must be "local" or "s3"' }).default("local"),
    STORAGE_BUCKET: optionalString,
    STORAGE_REGION: optionalString,
    STORAGE_ACCESS_KEY: optionalString,
    STORAGE_SECRET_KEY: optionalString,
    STORAGE_ENDPOINT: optionalString,
    /** Where readers load S3 objects from, such as a CDN address. */
    STORAGE_PUBLIC_URL: optionalString,
    /** Where the local provider keeps uploads, outside the source tree. */
    STORAGE_LOCAL_DIR: z.string().trim().min(1).default(".data/uploads"),

    /** Shown on the privacy and terms pages. They say so plainly when these aren't set. */
    LEGAL_RESPONSIBLE_NAME: optionalString,
    LEGAL_CONTACT_EMAIL: optionalString,
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, message: string) => {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message });
    };

    if (env.YOUTUBE_API_ENABLED) {
      require("YOUTUBE_API_KEY", "is required when YOUTUBE_API_ENABLED=true");
    }

    if (env.STORAGE_PROVIDER === "s3") {
      for (const key of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY"] as const) {
        require(key, "is required when STORAGE_PROVIDER=s3");
      }
    }

    if (env.CRON_SECRET && env.CRON_SECRET.length < 32) {
      ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "must be at least 32 characters" });
    }

    if (env.NODE_ENV === "production") {
      for (const key of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "NEXTAUTH_URL"] as const) {
        require(key, "is required in production");
      }
      if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) {
        ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "must be at least 32 characters" });
      }
    }

    // One of the pair alone is always a mistake, in any environment.
    if (Boolean(env.AUTH_GOOGLE_ID) !== Boolean(env.AUTH_GOOGLE_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: [env.AUTH_GOOGLE_ID ? "AUTH_GOOGLE_SECRET" : "AUTH_GOOGLE_ID"],
        message: "must be set together with its Google OAuth counterpart",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee .env.example and README.md.`);
    this.name = "InvalidEnvironmentError";
  }
}

/**
 * Validates configuration. Messages name the variable and the rule but never include
 * its value, so secrets cannot reach logs.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  throw new InvalidEnvironmentError(
    result.error.issues.map((issue) => `${issue.path.join(".") || "environment"} ${issue.message}`),
  );
}

let cached: Env | undefined;

/** Server-only access to validated configuration. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
