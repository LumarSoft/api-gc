import { Controller, Get, Param } from '@nestjs/common'
import { CategoriesService } from './categories.service'
import { CategoryResponseDto } from './dto/category-response.dto'
import { CategorySlugParamDto } from './dto/category-slug-param.dto'

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findTree(): Promise<CategoryResponseDto[]> {
    return this.categoriesService.findTree()
  }

  @Get(':slug')
  findBySlug(@Param() params: CategorySlugParamDto): Promise<CategoryResponseDto> {
    return this.categoriesService.findBySlug(params.slug)
  }
}
