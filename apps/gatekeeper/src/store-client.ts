// The two store endpoints Gatekeeper calls, with the founder key: the event feed and the
// approval decision (api/openapi.yaml).

import type { Department, StoreEvent } from '@switch-gear/shared';
import type { Decision } from './approvals';

export interface ApprovalSummary {
  id: string;
  department: Department;
  action: string;
  status: string;
}

export type DecisionOutcome =
  { ok: true; approval: ApprovalSummary } | { ok: false; status: number; code: string };

export interface StoreClient {
  events(after: number, limit?: number): Promise<StoreEvent[]>;
  approval(id: string): Promise<ApprovalSummary | null>;
  decide(decision: Decision): Promise<DecisionOutcome>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createStoreClient(options: {
  /** API base ending in /api/v1. */
  baseUrl: string;
  founderKey: string;
  fetch?: typeof globalThis.fetch;
}): StoreClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${options.founderKey}`, accept: 'application/json' };

  async function get(path: string): Promise<Response> {
    return doFetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
  }

  return {
    async events(after, limit = 100) {
      const res = await get(`/events?after=${after}&limit=${limit}`);
      if (!res.ok) throw new StoreError(`GET /events → ${res.status}`, res.status);
      const body: unknown = await res.json();
      if (!Array.isArray(body))
        throw new StoreError('GET /events did not return a list', res.status);
      // Unknown types are kept (the cursor must move past them); the caller decides what to do.
      return body.filter(
        (e): e is StoreEvent =>
          e !== null &&
          typeof e === 'object' &&
          typeof e.seq === 'number' &&
          typeof e.type === 'string',
      );
    },

    async approval(id) {
      const res = await get(`/approvals/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new StoreError(`GET /approvals/${id} → ${res.status}`, res.status);
      return toSummary(await res.json());
    },

    async decide(decision) {
      const body =
        decision.decision === 'approve'
          ? { decision: 'approve' }
          : { decision: 'reject', reason: decision.reason };
      const res = await doFetch(
        `${base}/approvals/${encodeURIComponent(decision.approvalId)}/decision`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const json: unknown = await res.json().catch(() => null);
      if (res.ok) return { ok: true, approval: toSummary(json) };
      // Error schema: { error: <code>, details? }.
      const code = (json as { error?: unknown } | null)?.error;
      return {
        ok: false,
        status: res.status,
        code: typeof code === 'string' ? code : `http_${res.status}`,
      };
    },
  };
}

function toSummary(json: unknown): ApprovalSummary {
  const a = (json ?? {}) as Record<string, unknown>;
  return {
    id: String(a.id ?? ''),
    department: a.department as Department,
    action: String(a.action ?? ''),
    status: String(a.status ?? ''),
  };
}
