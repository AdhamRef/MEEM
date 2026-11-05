import { describe, expect, it } from "vitest";
import { AppError, isTransactionConflictError, isUniqueConstraintError, toPublicError } from "./index";

describe("toPublicError", () => {
  it("exposes the code, message and status of expected errors", () => {
    expect(toPublicError(new AppError("FORBIDDEN"))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(toPublicError(new AppError("NOT_FOUND", "رسالة مخصصة")).message).toBe("رسالة مخصصة");
  });

  it("hides the details of unexpected errors", () => {
    const result = toPublicError(new Error("connection string mongodb://user:password@host"));
    expect(result.code).toBe("INTERNAL");
    expect(result.status).toBe(500);
    expect(result.message).not.toContain("password");
  });

  it("handles thrown values that are not errors", () => {
    expect(toPublicError("oops").code).toBe("INTERNAL");
    expect(toPublicError(undefined).code).toBe("INTERNAL");
  });
});

describe("isUniqueConstraintError", () => {
  it("recognises only the Prisma unique-constraint code", () => {
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isUniqueConstraintError(new Error("x"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});

describe("isTransactionConflictError", () => {
  it("recognises only the Prisma transaction-conflict code", () => {
    expect(isTransactionConflictError({ code: "P2034" })).toBe(true);
    expect(isTransactionConflictError({ code: "P2002" })).toBe(false);
    expect(isTransactionConflictError(undefined)).toBe(false);
  });
});
