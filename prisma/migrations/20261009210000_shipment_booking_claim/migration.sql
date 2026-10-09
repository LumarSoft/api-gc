-- Marks a shipment booking in flight, so a retry after a provider timeout does not book it twice.
-- AlterTable
ALTER TABLE `Shipment` ADD COLUMN `bookingStartedAt` DATETIME(3) NULL;

