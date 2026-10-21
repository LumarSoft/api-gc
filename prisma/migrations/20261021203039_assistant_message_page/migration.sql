-- AlterTable
ALTER TABLE `AssistantMessage` ADD COLUMN `productId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `AssistantMessage_productId_idx` ON `AssistantMessage`(`productId`);

-- AddForeignKey
ALTER TABLE `AssistantMessage` ADD CONSTRAINT `AssistantMessage_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
