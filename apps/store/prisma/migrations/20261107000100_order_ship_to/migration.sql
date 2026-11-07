-- Delivery details are stored per order so a later order from the same email can't
-- change where an earlier order goes. No orders exist before this migration (checkout
-- arrives in the same change), so NOT NULL without a default is safe.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shipAddress" TEXT NOT NULL,
ADD COLUMN     "shipCity" TEXT NOT NULL,
ADD COLUMN     "shipName" TEXT NOT NULL,
ADD COLUMN     "shipPhone" TEXT NOT NULL,
ADD COLUMN     "shipPincode" TEXT NOT NULL,
ADD COLUMN     "shipState" TEXT NOT NULL;
