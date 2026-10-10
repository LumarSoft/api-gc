-- Large equipment is quoted by weight and measurements like any product, so the "bulky" flag is no longer used.
-- AlterTable
ALTER TABLE `ProductVariant` DROP COLUMN `isBulky`;

