import type { FieldErrors, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/** Tiny zod -> react-hook-form resolver (avoids a heavy dependency; first issue per field wins). */
export function zodResolver<T extends Record<string, any>>(schema: ZodType<any, any, any>): Resolver<T> {
  return async (values) => {
    const r = schema.safeParse(values);
    if (r.success) return { values: r.data as T, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const i of r.error.issues) {
      const k = String(i.path[0] ?? "root");
      if (!errors[k]) errors[k] = { type: i.code, message: i.message };
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
