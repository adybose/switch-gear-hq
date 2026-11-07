import type {
  ApprovalRequest,
  ApprovalStatus,
  Department,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client';
import { recordEvent } from './events';

// Approval requests (docs/architecture.md "Approval gates"). A gated route that fails its
// gate (gates.ts) calls requestApproval() in the same transaction it would have used for the
// action, and answers 202. The founder decides through POST /approvals/{id}/decision; on
// approve the store runs the stored action with the executor registered for it.

/** Runs an approved action inside the decision transaction. Writes the action's own events. */
export type ApprovalExecutor = (
  tx: Prisma.TransactionClient,
  payload: Prisma.JsonValue,
  approval: ApprovalRequest,
) => Promise<void>;

/** Optional clean-up on reject (e.g. mark a pending refund `rejected`). */
export type ApprovalRejecter = ApprovalExecutor;

const executors = new Map<string, { execute: ApprovalExecutor; reject?: ApprovalRejecter }>();

/** Each gated action registers how to run it once approved (refund.create, ...). */
export function registerApprovalAction(
  action: string,
  execute: ApprovalExecutor,
  reject?: ApprovalRejecter,
): void {
  executors.set(action, { execute, reject });
}

/** For tests. */
export function clearApprovalActions(): void {
  executors.clear();
}

export interface PendingApproval {
  approvalId: string;
  status: 'pending';
}

/**
 * Stores an over-limit request and writes `approval.requested`. Call it with the
 * transaction of the gated route, so the request and any linked row (e.g. a refund in
 * `pending_approval`) commit together.
 */
export async function requestApproval(
  tx: Prisma.TransactionClient,
  input: {
    department: Department;
    action: string;
    payload: Prisma.InputJsonValue;
    amountPaise?: number | null;
    reason: string;
  },
): Promise<PendingApproval> {
  const [{ n }] = await tx.$queryRaw<[{ n: bigint }]>`SELECT nextval('approval_number_seq') AS n`;
  const number = `APR-${n}`;
  await tx.approvalRequest.create({
    data: {
      number,
      department: input.department,
      action: input.action,
      payload: input.payload,
      amountPaise: input.amountPaise ?? null,
      reason: input.reason,
    },
  });
  await recordEvent(tx, {
    type: 'approval.requested',
    entityType: 'approval',
    entityId: number,
    payload: {
      approvalId: number,
      department: input.department,
      action: input.action,
      amountPaise: input.amountPaise ?? null,
      reason: input.reason,
    },
  });
  return { approvalId: number, status: 'pending' };
}

/** 202 body for a gated endpoint (PendingApproval in api/openapi.yaml). */
export function pendingApprovalResponse(pending: PendingApproval): Response {
  return Response.json(pending, { status: 202 });
}

export class ApprovalError extends Error {
  override name = 'ApprovalError';
  constructor(
    readonly status: 404 | 409,
    readonly code: 'not_found' | 'already_decided' | 'action_not_supported',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Records the founder's decision. The status flip is a conditional update (`pending` →
 * decided), so of two concurrent decisions exactly one wins; the other waits on the row
 * lock, then matches nothing and gets 409. On approve, the executor runs in the same
 * transaction: if it throws, the decision rolls back and the request stays pending.
 */
export async function decideApproval(
  db: PrismaClient,
  input: {
    number: string;
    decision: 'approve' | 'reject';
    reason: string | null;
    decidedBy: string;
    now?: Date;
  },
): Promise<ApprovalRequest> {
  return db.$transaction(
    async (tx) => {
      const existing = await tx.approvalRequest.findUnique({ where: { number: input.number } });
      if (!existing) throw new ApprovalError(404, 'not_found', `No approval ${input.number}.`);
      const handler = executors.get(existing.action);
      if (input.decision === 'approve' && !handler) {
        throw new ApprovalError(
          409,
          'action_not_supported',
          `The store can't run ${existing.action} yet, so it can't be approved.`,
        );
      }

      const status: ApprovalStatus = input.decision === 'approve' ? 'approved' : 'rejected';
      const decidedAt = input.now ?? new Date();
      const { count } = await tx.approvalRequest.updateMany({
        where: { id: existing.id, status: 'pending' },
        data: { status, decidedBy: input.decidedBy, decidedAt, decisionReason: input.reason },
      });
      if (count === 0) {
        const current = await tx.approvalRequest.findUniqueOrThrow({ where: { id: existing.id } });
        throw new ApprovalError(
          409,
          'already_decided',
          `${input.number} is already ${current.status}.`,
        );
      }
      const decided = await tx.approvalRequest.findUniqueOrThrow({ where: { id: existing.id } });

      if (input.decision === 'approve') await handler!.execute(tx, decided.payload, decided);
      else await handler?.reject?.(tx, decided.payload, decided);

      await recordEvent(tx, {
        type: 'approval.decided',
        entityType: 'approval',
        entityId: decided.number,
        payload: {
          approvalId: decided.number,
          action: decided.action,
          decision: status,
          decidedBy: input.decidedBy,
          reason: input.reason,
        },
      });
      return decided;
    },
    { timeout: 15000, maxWait: 10000 },
  );
}

/** The Approval schema in api/openapi.yaml; `id` is the human number (APR-7). */
export function approvalJson(a: ApprovalRequest) {
  return {
    id: a.number,
    department: a.department,
    action: a.action,
    payload: a.payload,
    amountPaise: a.amountPaise,
    reason: a.reason,
    status: a.status,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionReason: a.decisionReason,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function listApprovals(
  db: PrismaClient,
  status?: ApprovalStatus,
): Promise<ApprovalRequest[]> {
  return db.approvalRequest.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
