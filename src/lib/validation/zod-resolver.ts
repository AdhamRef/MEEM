import type { FieldError, FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/**
 * Connects a Zod schema to React Hook Form, which needs only this much of the separate
 * resolvers package. The server validates again on save, so this is only for quick feedback.
 */
export function zodResolver<Values extends FieldValues>(schema: z.ZodType<Values, Values>): Resolver<Values> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };

    const errors: Record<string, FieldError> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      errors[key] ??= { type: issue.code ?? "custom", message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<Values> };
  };
}
