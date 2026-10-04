import { Module } from '@nestjs/common'
import { AdminBrandsController } from './admin-brands.controller'
import { AdminBrandsService } from './admin-brands.service'
import { BrandsController } from './brands.controller'
import { BrandsService } from './brands.service'

@Module({
  controllers: [BrandsController, AdminBrandsController],
  providers: [BrandsService, AdminBrandsService],
})
export class BrandsModule {}
