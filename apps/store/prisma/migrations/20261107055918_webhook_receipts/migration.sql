-- CreateEnum
CREATE TYPE "WebhookPartner" AS ENUM ('paymock', 'printhub', 'shipfast');

-- CreateEnum
CREATE TYPE "WebhookOutcome" AS ENUM ('processed', 'ignored');

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "partner" "WebhookPartner" NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" "WebhookOutcome" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_partner_eventId_key" ON "WebhookReceipt"("partner", "eventId");
