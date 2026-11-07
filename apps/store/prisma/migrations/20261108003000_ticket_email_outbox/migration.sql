-- Simulated email outbox. Replies, queued mail and ticket.replied events commit together.
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailOutbox_ticketId_idx" ON "EmailOutbox"("ticketId");
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
