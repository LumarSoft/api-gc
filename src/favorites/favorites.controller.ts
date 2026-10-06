import { Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Put, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { FavoriteProductParamDto } from './dto/favorite-input.dto'
import type { FavoritesResponseDto } from './dto/favorites-response.dto'
import { FavoritesService } from './favorites.service'

/** Saved products of the signed-in customer. Guests are asked to sign in by the front. */
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthenticatedUser): Promise<FavoritesResponseDto> {
    return this.favorites.list(user)
  }

  @Put(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  add(@CurrentUser() user: AuthenticatedUser, @Param() params: FavoriteProductParamDto): Promise<void> {
    return this.favorites.add(user, params.productId)
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: FavoriteProductParamDto): Promise<void> {
    return this.favorites.remove(user, params.productId)
  }
}
