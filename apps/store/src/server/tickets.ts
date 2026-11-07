import type { PrismaClient } from '../generated/prisma/client';
import { recordEvent } from './events';
import type { TicketInput } from './validation/tickets';

/**
 * Creates a ticket from the website contact/return form and records `ticket.created`.
 *
 * The order is linked only when the email matches the order's customer; otherwise the ticket
 * is created without an order, so the form cannot confirm that an order number exists.
 */
export async function createTicket(
  db: PrismaClient,
  input: TicketInput,
  now: Date,
): Promise<{ ticketNumber: string }> {
  const email = input.email.trim().toLowerCase();

  return db.$transaction(async (tx) => {
    const order = input.orderNumber
      ? await tx.order.findUnique({
          where: { number: input.orderNumber },
          select: { id: true, number: true, customer: { select: { id: true, email: true } } },
        })
      : null;
    const linked = order && order.customer.email.toLowerCase() === email ? order : null;

    // The ticket needs a Customer row. Someone with no orders gets a bare one (email only).
    const customerId =
      linked?.customer.id ??
      (await tx.customer.findFirst({ where: { email }, orderBy: { createdAt: 'asc' } }))?.id ??
      (
        await tx.customer.create({
          data: {
            name: email.split('@')[0]!,
            email,
            phone: '',
            address: '',
            city: '',
            state: '',
            pincode: '',
          },
        })
      ).id;

    const [{ n }] = await tx.$queryRaw<[{ n: bigint }]>`SELECT nextval('ticket_number_seq') AS n`;
    const ticketNumber = `TCK-${n}`;

    await tx.ticket.create({
      data: {
        number: ticketNumber,
        orderId: linked?.id ?? null,
        customerId,
        type: input.type,
        status: 'open',
        messages: [{ from: 'customer', body: input.message, at: now.toISOString() }],
      },
    });
    await recordEvent(tx, {
      type: 'ticket.created',
      entityType: 'ticket',
      entityId: ticketNumber,
      payload: { ticketNumber, orderNumber: linked?.number ?? null, type: input.type },
      at: now,
    });
    return { ticketNumber };
  });
}
