import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { diffForAudit } from '../audit-logs/lib/audit-diff'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { Currency, DeliveryMethod } from '../generated/prisma/enums'
import { reservationHours } from '../orders/lib/reservation-hours'
import { PrismaService } from '../prisma/prisma.service'
import type { UpdateLocalDeliveryDto, UpdateReservationDto } from './dto/settings-input.dto'
import type { AdminSettingsDto } from './dto/settings-response.dto'
import { LOCAL_DELIVERY_DEFAULTS, localDeliveryProblem, RESERVATION_HOURS_KEY } from './lib/settings-rules'

const money = (value: Prisma.Decimal | null) => (value ? { amount: value.toFixed(2), currency: Currency.ARS } : null)

/** Store settings staff change from the admin: Rosario delivery and the manual-payment reservation window. */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async read(): Promise<AdminSettingsDto> {
    const [local, reservation] = await Promise.all([
      this.localDelivery(),
      this.prisma.setting.findUnique({
        where: { key: RESERVATION_HOURS_KEY },
        select: { value: true, deletedAt: true },
      }),
    ])
    return {
      localDelivery: {
        isActive: Boolean(local?.isActive),
        flatRate: money(local?.flatRate ?? null),
        freeShippingThreshold: money(local?.freeShippingThreshold ?? null),
      },
      reservation: { manualHours: reservationHours(reservation), isDefault: !reservation || !!reservation.deletedAt },
    }
  }

  async updateLocalDelivery(input: UpdateLocalDeliveryDto, actor: AuditActor): Promise<AdminSettingsDto> {
    const next = {
      isActive: input.isActive,
      flatRate: input.flatRate ? new Prisma.Decimal(input.flatRate) : null,
      freeShippingThreshold: input.freeShippingThreshold ? new Prisma.Decimal(input.freeShippingThreshold) : null,
    }
    const problem = localDeliveryProblem(next)
    if (problem) throw new UnprocessableEntityException(problem)

    await this.prisma.$transaction(async tx => {
      const before = await tx.shippingMethod.findUnique({ where: { code: DeliveryMethod.LOCAL_DELIVERY } })
      const data = { ...next, currency: Currency.ARS, deletedAt: null }
      const saved = before
        ? await tx.shippingMethod.update({ where: { id: before.id }, data })
        : await tx.shippingMethod.create({
            data: { code: DeliveryMethod.LOCAL_DELIVERY, ...LOCAL_DELIVERY_DEFAULTS, ...data },
          })
      await this.audit.record(
        actor,
        {
          action: 'settings.local-delivery',
          entityType: 'ShippingMethod',
          entityId: saved.id,
          changes: diffForAudit(before && this.auditShape(before), this.auditShape(saved)),
        },
        tx,
      )
    })
    return this.read()
  }

  async updateReservation(input: UpdateReservationDto, actor: AuditActor): Promise<AdminSettingsDto> {
    await this.prisma.$transaction(async tx => {
      const before = await tx.setting.findUnique({ where: { key: RESERVATION_HOURS_KEY } })
      const saved = await tx.setting.upsert({
        where: { key: RESERVATION_HOURS_KEY },
        create: {
          key: RESERVATION_HOURS_KEY,
          value: input.manualHours,
          description: 'Hours a pending manual-payment order keeps its stock reserved (1–168).',
        },
        update: { value: input.manualHours, deletedAt: null },
      })
      await this.audit.record(
        actor,
        {
          action: 'settings.reservation',
          entityType: 'Setting',
          entityId: saved.id,
          changes: { manualHours: { from: reservationHours(before), to: input.manualHours } },
        },
        tx,
      )
    })
    return this.read()
  }

  private localDelivery() {
    return this.prisma.shippingMethod.findFirst({
      where: { code: DeliveryMethod.LOCAL_DELIVERY, deletedAt: null },
      select: { isActive: true, flatRate: true, freeShippingThreshold: true },
    })
  }

  private auditShape(method: {
    isActive: boolean
    flatRate: Prisma.Decimal | null
    freeShippingThreshold: Prisma.Decimal | null
  }) {
    return {
      isActive: method.isActive,
      flatRate: method.flatRate?.toFixed(2) ?? null,
      freeShippingThreshold: method.freeShippingThreshold?.toFixed(2) ?? null,
    }
  }
}
