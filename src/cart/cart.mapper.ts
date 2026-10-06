import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { Currency, ProductStatus } from '../generated/prisma/enums'
import { PricingService, type PriceContext } from '../pricing/pricing.service'
import type { CartItemDto, CartResponseDto } from './dto/cart-response.dto'
import { cartItemIssue } from './lib/cart-rules'
import type { CartVariantRow } from './lib/cart-selects'

@Injectable()
export class CartMapper {
  constructor(
    private readonly pricing: PricingService,
    private readonly files: FilesService,
  ) {}

  item(variant: CartVariantRow, quantity: number, context: PriceContext): CartItemDto {
    const unitPrice = this.pricing.resolve(variant.prices, context)?.price ?? null
    const visible =
      variant.isActive &&
      !variant.deletedAt &&
      !variant.product.deletedAt &&
      variant.product.status === ProductStatus.PUBLISHED
    const availableQuantity =
      variant.inventory && !variant.inventory.deletedAt
        ? Math.max(0, variant.inventory.onHand - variant.inventory.reserved)
        : 0
    const issue = cartItemIssue(visible, unitPrice?.currency, availableQuantity, quantity)
    const total =
      visible && unitPrice?.currency === Currency.ARS
        ? { amount: new Prisma.Decimal(unitPrice.amount).mul(quantity).toFixed(2), currency: Currency.ARS }
        : null
    const image = variant.product.images[0]
    return {
      variantId: variant.id,
      sku: variant.sku,
      name: variant.product.name,
      variantName: variant.name,
      productSlug: variant.product.slug,
      imageUrl: image ? this.files.publicUrl(image.file.storageKey) : null,
      quantity,
      availableQuantity,
      unitPrice,
      total,
      issue,
    }
  }

  response(items: CartItemDto[]): CartResponseDto {
    const subtotal = items.every(item => item.total !== null)
      ? {
          amount: items.reduce((sum, item) => sum.add(item.total!.amount), new Prisma.Decimal(0)).toFixed(2),
          currency: Currency.ARS,
        }
      : null
    return {
      items,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal,
      hasIssues: items.some(item => item.issue !== null),
    }
  }
}
