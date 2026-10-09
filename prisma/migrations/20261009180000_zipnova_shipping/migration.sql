-- Carrier shipping through Zipnova: quotes keep the provider selection per cart and destination, shipments keep it plus
-- the carrier status. Both tables had no writer before, so they are empty.
-- DropForeignKey
ALTER TABLE `ShippingQuote` DROP FOREIGN KEY `ShippingQuote_cartId_fkey`;

-- AlterTable
ALTER TABLE `Shipment` DROP COLUMN `pickedUpAt`,
    DROP COLUMN `readyAt`,
    ADD COLUMN `carrierId` INTEGER NULL,
    ADD COLUMN `carrierStatus` VARCHAR(100) NULL,
    ADD COLUMN `logisticType` VARCHAR(40) NULL,
    ADD COLUMN `pickupPoint` VARCHAR(255) NULL,
    ADD COLUMN `pickupPointId` INTEGER NULL,
    ADD COLUMN `serviceType` VARCHAR(40) NULL,
    MODIFY `status` ENUM('PENDING', 'IN_TRANSIT', 'READY_FOR_PICKUP', 'DELIVERED', 'RETURNED', 'CANCELLED', 'LOST') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `ShippingQuote` DROP COLUMN `externalQuoteId`,
    ADD COLUMN `carrierId` INTEGER NOT NULL,
    ADD COLUMN `city` VARCHAR(100) NOT NULL,
    ADD COLUMN `cost` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `itemsHash` VARCHAR(64) NOT NULL,
    ADD COLUMN `logisticType` VARCHAR(40) NOT NULL,
    ADD COLUMN `pickupPoint` VARCHAR(255) NULL,
    ADD COLUMN `pickupPointId` INTEGER NULL,
    ADD COLUMN `province` VARCHAR(100) NOT NULL,
    ADD COLUMN `serviceType` VARCHAR(40) NOT NULL,
    MODIFY `cartId` INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Shipment_externalId_key` ON `Shipment`(`externalId`);

-- AddForeignKey
ALTER TABLE `ShippingQuote` ADD CONSTRAINT `ShippingQuote_cartId_fkey` FOREIGN KEY (`cartId`) REFERENCES `Cart`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

