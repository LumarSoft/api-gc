import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import type { OrderResponseDto } from '../orders/dto/order-response.dto'
import { ShipmentDocumentParamsDto, ShipmentDocumentQueryDto } from './dto/shipment-input.dto'
import { ShipmentBookingService } from './shipment-booking.service'
import { ShipmentsService } from './shipments.service'

/** The carrier shipment of an order. Every route answers with the updated admin order. */
@Controller('admin/orders/:id/shipment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminShipmentsController {
  constructor(
    private readonly bookings: ShipmentBookingService,
    private readonly shipments: ShipmentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  create(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<OrderResponseDto> {
    return this.bookings.create(params.id, actor)
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  cancel(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<OrderResponseDto> {
    return this.shipments.cancel(params.id, actor)
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  refresh(@Param() params: IdParamDto): Promise<OrderResponseDto> {
    return this.shipments.refresh(params.id)
  }

  @Get('documents/:kind')
  @Header('Cache-Control', 'private, no-store')
  async document(
    @Param() params: ShipmentDocumentParamsDto,
    @Query() query: ShipmentDocumentQueryDto,
  ): Promise<StreamableFile> {
    const file = await this.shipments.document(params.id, params.kind, query.format)
    return new StreamableFile(file.content, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
    })
  }
}
