-- DropForeignKey
ALTER TABLE `Order` DROP FOREIGN KEY `Order_userId_fkey`;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `accessTokenHash` VARCHAR(64) NULL,
    MODIFY `userId` INTEGER NULL,
    MODIFY `paymentMethod` ENUM('MANUAL', 'MERCADO_PAGO', 'BANK_TRANSFER', 'CURRENT_ACCOUNT') NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Order_accessTokenHash_key` ON `Order`(`accessTokenHash`);

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
