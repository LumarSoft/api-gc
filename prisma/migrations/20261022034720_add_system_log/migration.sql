-- CreateTable
CREATE TABLE `SystemLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `level` ENUM('ERROR', 'WARN') NOT NULL,
    `source` VARCHAR(100) NOT NULL,
    `route` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SystemLog_createdAt_idx`(`createdAt`),
    INDEX `SystemLog_level_createdAt_idx`(`level`, `createdAt`),
    INDEX `SystemLog_source_createdAt_idx`(`source`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
