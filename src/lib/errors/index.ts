import { strings } from "@/config/strings.ar";

/**
 * Expected failures carry a safe public message. Anything else is reported to users as
 * a generic internal error, so stack traces and internals never reach them (§21).
 */
export type AppErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EXTERNAL_UNAVAILABLE"
  | "INTERNAL";

const httpStatusByCode: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EXTERNAL_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const defaultMessages: Record<AppErrorCode, string> = {
  VALIDATION: strings.errors.validation,
  UNAUTHENTICATED: strings.errors.unauthenticated,
  FORBIDDEN: strings.errors.forbidden,
  NOT_FOUND: strings.errors.notFound,
  CONFLICT: strings.errors.conflict,
  RATE_LIMITED: strings.errors.rateLimited,
  EXTERNAL_UNAVAILABLE: strings.errors.externalUnavailable,
  INTERNAL: strings.errors.internal,
};

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly publicMessage: string = defaultMessages[code],
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "AppError";
  }

  get httpStatus(): number {
    return httpStatusByCode[this.code];
  }
}

export interface PublicError {
  code: AppErrorCode;
  message: string;
  status: number;
}

/** Converts any thrown value into what may safely be shown to a user. */
export function toPublicError(error: unknown): PublicError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.publicMessage, status: error.httpStatus };
  }
  return { code: "INTERNAL", message: defaultMessages.INTERNAL, status: httpStatusByCode.INTERNAL };
}

function prismaErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** True for Prisma's unique-constraint failure. Raw commands report failures differently. */
export function isUniqueConstraintError(error: unknown): boolean {
  return prismaErrorCode(error) === "P2002";
}

/** True when MongoDB aborted a transaction because a concurrent one touched the same data. */
export function isTransactionConflictError(error: unknown): boolean {
  return prismaErrorCode(error) === "P2034";
}
