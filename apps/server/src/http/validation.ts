import type { z } from "zod";
import { ServiceError } from "../errors";

/**
 * Parse a request body/params with a shared Zod schema. Zod issues become a
 * flat `{ field: message }` map so the client can highlight inputs.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    fields[key] ??= issue.message;
  }
  throw new ServiceError("validation", "Check the highlighted fields.", fields);
}
