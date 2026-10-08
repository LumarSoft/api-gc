-- ActivityEvent had no writer until now (the table is empty everywhere), so dropping its columns loses nothing.
-- Visitors become anonymous browser ids: no account link, no free-form metadata.

-- DropForeignKey
ALTER TABLE `ActivityEvent` DROP FOREIGN KEY `ActivityEvent_userId_fkey`;

-- DropIndex
DROP INDEX `ActivityEvent_userId_idx` ON `ActivityEvent`;

-- AlterTable
ALTER TABLE `ActivityEvent` DROP COLUMN `metadata`,
    DROP COLUMN `sessionId`,
    DROP COLUMN `userId`,
    ADD COLUMN `resultCount` INTEGER NULL,
    ADD COLUMN `visitorId` CHAR(36) NOT NULL,
    MODIFY `type` ENUM('VISIT', 'PRODUCT_VIEW', 'SEARCH', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'ORDER_PLACED') NOT NULL,
    MODIFY `searchQuery` VARCHAR(100) NULL;

