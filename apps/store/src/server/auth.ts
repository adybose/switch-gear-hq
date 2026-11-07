import type { Department, PrismaClient } from '../generated/prisma/client';
import { hashApiKey } from './api-keys';
import { errorResponse } from './http';
import { hasScope, type Scope } from './scopes';

/**
 * Checks `Authorization: Bearer sg_<department>_<random>` against the stored key hashes.
 * Returns the key's department, or a 401 response. Use `authorize()` for endpoints that
 * need a scope.
 */
export async function authenticate(
  db: PrismaClient,
  request: Request,
): Promise<{ department: Department } | { response: Response }> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(sg_[a-z]+_[A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!match) {
    return { response: errorResponse(401, 'unauthorized', { authorization: 'Missing API key.' }) };
  }
  const key = await db.apiKey.findUnique({
    where: { hash: hashApiKey(match[1]!) },
    select: { department: true, revokedAt: true },
  });
  if (!key || key.revokedAt) {
    return { response: errorResponse(401, 'unauthorized', { authorization: 'Invalid API key.' }) };
  }
  return { department: key.department };
}

/** `authenticate()` plus a scope check: 401 for a bad key, 403 when the key lacks `scope`. */
export async function authorize(
  db: PrismaClient,
  request: Request,
  scope: Scope,
): Promise<{ department: Department } | { response: Response }> {
  const auth = await authenticate(db, request);
  if ('response' in auth) return auth;
  if (!hasScope(auth.department, scope)) {
    return {
      response: errorResponse(403, 'forbidden', {
        authorization: `The ${auth.department} key does not have the ${scope} scope.`,
      }),
    };
  }
  return auth;
}
