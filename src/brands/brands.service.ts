import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { BrandResponseDto } from './dto/brand-response.dto'

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  /** Active brands for filters. Small and bounded: no pagination needed. */
  async findAll(): Promise<BrandResponseDto[]> {
    const brands = await this.prisma.brand.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, logoFile: { select: { storageKey: true } } },
    })
    return brands.map(brand => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      logoUrl: brand.logoFile ? this.files.publicUrl(brand.logoFile.storageKey) : null,
    }))
  }
}
