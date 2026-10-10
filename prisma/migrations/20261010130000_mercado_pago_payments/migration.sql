-- Mercado Pago Checkout Pro: a new checkout link is created each time the buyer goes to pay (it expires with the
-- reservation), so the preference id is not stored. The table had only manual payments, which never set it.
-- AlterTable
ALTER TABLE `Payment` DROP COLUMN `preferenceId`;
