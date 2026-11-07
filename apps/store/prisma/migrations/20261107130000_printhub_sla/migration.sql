-- Business-time SLA, independent of real createdAt/updatedAt.
ALTER TABLE "PrintJob"
  ADD COLUMN "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "dueAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 days'),
  ADD COLUMN "lateReportedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PrintJob_orderId_attempt_key" ON "PrintJob"("orderId", "attempt");
