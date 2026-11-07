import type { Department, PrismaClient } from '../generated/prisma/client';
import { hashApiKey } from './api-keys';
import { errorResponse } from './http';

/**
 * Checks `Authorization: Bearer sg_<department>_<random>` against the stored key hashes.
 * Returns the key's department, or a 401 response. Per-department scopes are T-09.
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
