import type { z } from 'zod';
import { fieldErrors } from './validation/checkout';

/** `{ error, details }` per the Error schema in api/openapi.yaml. */
export function errorResponse(
  status: number,
  error: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(details ? { error, details } : { error }, { status });
}

/** Parses a JSON body with a zod schema; returns the data or a ready 422 response. */
export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: errorResponse(422, 'invalid_json', { '(body)': 'Body must be JSON.' }) };
  }
  const result = schema.safeParse(body);
  return result.success
    ? { data: result.data }
    : { response: errorResponse(422, 'validation_failed', fieldErrors(result.error)) };
}
