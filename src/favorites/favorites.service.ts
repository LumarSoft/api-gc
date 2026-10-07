import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { PrismaService } from '../prisma/prisma.service'
import { ProductsService } from '../products/products.service'
import type { FavoritesResponseDto } from './dto/favorites-response.dto'
import { MAX_FAVORITES } from './lib/favorite-rules'

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async list(user: AuthenticatedUser): Promise<FavoritesResponseDto> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_FAVORITES,
      select: { productId: true },
    })
    return {
      items: await this.products.findSummariesByIds(
        rows.map(row => row.productId),
        user,
      ),
    }
  }

  /** Idempotent: saving a product twice keeps one favorite. */
  async add(user: AuthenticatedUser, productId: number): Promise<void> {
    if (!(await this.products.isVisible(productId))) throw new NotFoundException('Producto no encontrado.')
    const key = { userId_productId: { userId: user.id, productId } }
    if (await this.prisma.favorite.findUnique({ where: key, select: { id: true } })) return
    if ((await this.prisma.favorite.count({ where: { userId: user.id } })) >= MAX_FAVORITES)
      throw new UnprocessableEntityException(`Podés guardar hasta ${MAX_FAVORITES} favoritos.`)
    await this.prisma.favorite.upsert({ where: key, create: { userId: user.id, productId }, update: {} })
  }

  /** Idempotent: removing a product that is not saved does nothing. */
  async remove(user: AuthenticatedUser, productId: number): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { userId: user.id, productId } })
  }
}
