-- AlterTable
ALTER TABLE `AssistantMessage` ADD COLUMN `durationMs` INTEGER NULL,
    ADD COLUMN `emptySearches` INTEGER NULL,
    ADD COLUMN `outcome` ENUM('ANSWERED', 'FAILED', 'INTERRUPTED') NULL,
    ADD COLUMN `toolCalls` JSON NULL;

-- CreateTable
CREATE TABLE `AssistantCartAdd` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `variantId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssistantCartAdd_conversationId_idx`(`conversationId`),
    INDEX `AssistantCartAdd_productId_idx`(`productId`),
    INDEX `AssistantCartAdd_variantId_idx`(`variantId`),
    INDEX `AssistantCartAdd_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `AssistantMessage_createdAt_idx` ON `AssistantMessage`(`createdAt`);

-- AddForeignKey
ALTER TABLE `AssistantCartAdd` ADD CONSTRAINT `AssistantCartAdd_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AssistantConversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantCartAdd` ADD CONSTRAINT `AssistantCartAdd_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantCartAdd` ADD CONSTRAINT `AssistantCartAdd_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
