ALTER TABLE "Shipment"
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reshipOfId" TEXT,
  ADD COLUMN "approvalId" TEXT,
  ADD COLUMN "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "estimatedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);
-- Preserve any existing/manual shipment history as a chain.
WITH history AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY "createdAt", id) AS n,
    LAG(id) OVER (PARTITION BY "orderId" ORDER BY "createdAt", id) AS previous
  FROM "Shipment"
)
UPDATE "Shipment" AS s SET "sequence" = h.n, "reshipOfId" = h.previous, "bookedAt" = s."createdAt"
FROM history h WHERE s.id = h.id;
CREATE UNIQUE INDEX "Shipment_orderId_sequence_key" ON "Shipment"("orderId", "sequence");
CREATE UNIQUE INDEX "Shipment_reshipOfId_key" ON "Shipment"("reshipOfId");
ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_reshipOfId_fkey" FOREIGN KEY ("reshipOfId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Shipment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Shipment_sequence_positive" CHECK ("sequence" > 0),
  ADD CONSTRAINT "Shipment_attempts_range" CHECK ("attempts" BETWEEN 0 AND 3);
