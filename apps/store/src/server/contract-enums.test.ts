import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ApprovalStatus,
  CampaignChannel,
  OrderSource,
  OrderStatus,
  TicketStatus,
  TicketType,
} from '../generated/prisma/enums';

// Keeps database enums in step with api/openapi.yaml: a value the API accepts must be
// storable, and the database must not hold values the API can't express.

const spec = parse(
  readFileSync(fileURLToPath(new URL('../../../../api/openapi.yaml', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

/** First `enum` found under a key named `name`, searching depth-first from `node`. */
function findEnum(node: unknown, name: string): string[] | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  // Query parameters are `{ name, schema: { enum } }`; schema properties are `name: { enum }`.
  if (record.name === name) {
    const values = (record.schema as { enum?: string[] } | undefined)?.enum;
    if (values) return values;
  }
  const own = record[name] as { enum?: string[] } | undefined;
  if (own && Array.isArray(own.enum)) return own.enum;
  for (const child of Object.values(record)) {
    const found = findEnum(child, name);
    if (found) return found;
  }
  return undefined;
}

const paths = spec.paths as Record<string, Record<string, unknown>>;
const schemas = (spec.components as { schemas: Record<string, { enum?: string[] }> }).schemas;

const cases: [string, Record<string, string>, string[] | undefined][] = [
  ['OrderStatus', OrderStatus, schemas.OrderStatus?.enum],
  ['OrderSource', OrderSource, findEnum(paths['/checkout'], 'source')],
  ['TicketStatus', TicketStatus, findEnum(paths['/tickets']?.get, 'status')],
  ['TicketType', TicketType, findEnum(paths['/tickets']?.post, 'type')],
  ['CampaignChannel', CampaignChannel, findEnum(paths['/campaigns']?.post, 'channel')],
  ['ApprovalStatus (list filter)', ApprovalStatus, findEnum(paths['/approvals']?.get, 'status')],
  ['ApprovalStatus (Approval schema)', ApprovalStatus, findEnum(schemas.Approval, 'status')],
];

describe('database enums match api/openapi.yaml', () => {
  it.each(cases)('%s', (_name, dbEnum, apiValues) => {
    expect(apiValues, 'enum not found in openapi.yaml').toBeDefined();
    expect(Object.values(dbEnum).sort()).toEqual([...(apiValues ?? [])].sort());
  });
});
