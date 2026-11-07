// Founder decisions typed in #approvals: `approve APR-7` or `reject APR-7 <reason>`.

export type Decision =
  | { decision: 'approve'; approvalId: string }
  | { decision: 'reject'; approvalId: string; reason: string };

export type ParseResult = Decision | { error: string } | null;

/**
 * Parses one message body. Leading mentions (`@gatekeeper`) are dropped. Returns null when the
 * message is not a decision at all, and `{error}` when it starts like one but is incomplete.
 */
export function parseDecision(body: string): ParseResult {
  const text = body
    .trim()
    .replace(/^(?:@\S+[\s,:]*)+/, '')
    .trim();
  const match = /^(approve|reject)\b\s*(.*)$/is.exec(text);
  if (!match) return null;
  const verb = match[1]!.toLowerCase() as 'approve' | 'reject';
  const rest = match[2]!.trim();
  const id = /^(APR-\d+)\b\s*(.*)$/is.exec(rest);
  if (!id) return { error: `Say which request: \`${verb} APR-7\`.` };
  const approvalId = id[1]!.toUpperCase();
  const reason = id[2]!.trim();
  if (verb === 'approve') return { decision: 'approve', approvalId };
  if (!reason) return { error: `A rejection needs a reason: \`reject ${approvalId} <reason>\`.` };
  if (reason.length > 500) return { error: 'Keep the reason under 500 characters.' };
  return { decision: 'reject', approvalId, reason };
}
