import { Module } from '@nestjs/common'
import { InventoryModule } from '../inventory/inventory.module'
import { PricingModule } from '../pricing/pricing.module'
import { AdminProductContentService } from './admin-product-content.service'
import { AdminProductDuplicatorService } from './admin-product-duplicator.service'
import { AdminProductMapper } from './admin-product.mapper'
import { AdminProductReader } from './admin-product.reader'
import { AdminProductsController } from './admin-products.controller'
import { AdminProductBulkService } from './admin-product-bulk.service'
import { AdminProductsService } from './admin-products.service'
import { AdminVariantPricesService } from './admin-variant-prices.service'
import { AdminVariantsController } from './admin-variants.controller'
import { AdminVariantsService } from './admin-variants.service'
import { CatalogReferences } from './catalog-references'
import { ProductsController } from './products.controller'
import { ProductMapper } from './product.mapper'
import { ProductsService } from './products.service'

@Module({
  imports: [PricingModule, InventoryModule],
  controllers: [ProductsController, AdminProductsController, AdminVariantsController],
  providers: [
    ProductsService,
    ProductMapper,
    AdminProductsService,
    AdminProductBulkService,
    AdminProductContentService,
    AdminProductDuplicatorService,
    AdminProductReader,
    AdminProductMapper,
    AdminVariantsService,
    AdminVariantPricesService,
    CatalogReferences,
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
