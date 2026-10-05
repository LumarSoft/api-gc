import { IsIn } from 'class-validator'
import { ProductStatus } from '../../../generated/prisma/enums'

export class UpdateProductStatusDto {
  @IsIn(Object.values(ProductStatus))
  status: ProductStatus
}
