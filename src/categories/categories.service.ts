import { Injectable, NotFoundException } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CategoryResponseDto } from './dto/category-response.dto'

const SUMMARY_SELECT = { id: true, name: true, slug: true } satisfies Prisma.CategorySelect

const CATEGORY_SELECT = {
  ...SUMMARY_SELECT,
  description: true,
  imageFile: { select: { storageKey: true } },
  parent: { select: SUMMARY_SELECT },
  children: {
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: SUMMARY_SELECT,
  },
} satisfies Prisma.CategorySelect

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  /** Top-level categories with their subcategories (the store menu). Small and bounded: no pagination needed. */
  async findTree(): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null, isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: CATEGORY_SELECT,
    })
    return categories.map(category => this.toResponse(category))
  }

  async findBySlug(slug: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findFirst({
      where: { slug, deletedAt: null, isActive: true },
      select: CATEGORY_SELECT,
    })
    if (!category) throw new NotFoundException(`Category ${slug} not found`)
    return this.toResponse(category)
  }

  private toResponse(category: {
    id: number
    name: string
    slug: string
    description: string | null
    imageFile: { storageKey: string } | null
    parent: { id: number; name: string; slug: string } | null
    children: { id: number; name: string; slug: string }[]
  }): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageFile ? this.files.publicUrl(category.imageFile.storageKey) : null,
      parent: category.parent,
      children: category.children,
    }
  }
}
