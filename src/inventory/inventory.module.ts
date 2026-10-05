import { Module } from '@nestjs/common'
import { StockService } from './stock.service'

/** Stock levels and their movement ledger. Reservations and the Tango sync will live here too. */
@Module({
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
