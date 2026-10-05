import { Module } from '@nestjs/common'
import { PricingModule } from '../pricing/pricing.module'
import { AdminProductContentService } from './admin-product-content.service'
import { AdminProductDuplicatorService } from './admin-product-duplicator.service'
import { AdminProductMapper } from './admin-product.mapper'
import { AdminProductReader } from './admin-product.reader'
import { AdminProductsController } from './admin-products.controller'
import { AdminProductsService } from './admin-products.service'
import { ProductsController } from './products.controller'
import { ProductMapper } from './product.mapper'
import { ProductsService } from './products.service'

@Module({
  imports: [PricingModule],
  controllers: [ProductsController, AdminProductsController],
  providers: [
    ProductsService,
    ProductMapper,
    AdminProductsService,
    AdminProductContentService,
    AdminProductDuplicatorService,
    AdminProductReader,
    AdminProductMapper,
  ],
})
export class ProductsModule {}
