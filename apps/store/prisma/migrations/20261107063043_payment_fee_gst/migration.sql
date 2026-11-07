-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "feeGstPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settlementRef" TEXT;

-- Money columns are never negative (as in the init migration).
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_money_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_money_check" CHECK ("amountPaise" >= 0 AND "feePaise" >= 0 AND "feeGstPaise" >= 0);
