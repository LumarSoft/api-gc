import { Controller, Get } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { BrandsService } from './brands.service'
import { BrandResponseDto } from './dto/brand-response.dto'

// Public catalog read: the front renders it on its server, where every visitor shares one IP. See docs/rules/security.md.
@SkipThrottle()
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  findAll(): Promise<BrandResponseDto[]> {
    return this.brandsService.findAll()
  }
}
