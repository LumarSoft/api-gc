import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { WholesaleStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateWholesaleApplicationDto } from './dto/wholesale-application-input.dto'
import type { MyWholesaleApplicationDto } from './dto/wholesale-application-response.dto'
import { isValidCuit } from './lib/cuit'
import { applicationSelect } from './lib/wholesale-application-selects'
import { applyBlockReason } from './lib/wholesale-rules'
import { WholesaleApplicationMapper } from './wholesale-application.mapper'

/** The signed-in customer's side: see the status of their frequent-customer account and apply for one. */
@Injectable()
export class WholesaleApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: WholesaleApplicationMapper,
  ) {}

  async mine(user: AuthenticatedUser): Promise<MyWholesaleApplicationDto> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { company: { select: { id: true, wholesaleStatus: true } } },
    })
    const application = row.company
      ? await this.prisma.wholesaleApplication.findFirst({
          where: { companyId: row.company.id, deletedAt: null },
          orderBy: { id: 'desc' },
          select: applicationSelect,
        })
      : null
    const blockReason = applyBlockReason(row.company?.wholesaleStatus ?? null)
    return {
      application: application ? this.mapper.customer(application) : null,
      canApply: blockReason === null,
      blockReason,
    }
  }

  async apply(user: AuthenticatedUser, input: CreateWholesaleApplicationDto): Promise<MyWholesaleApplicationDto> {
    if (!isValidCuit(input.cuit)) throw new UnprocessableEntityException('El CUIT no es válido. Revisá los 11 números.')
    const company = {
      legalName: input.legalName,
      tradeName: input.tradeName ?? null,
      cuit: input.cuit,
      taxCondition: input.taxCondition,
      email: input.email,
      phone: input.phone ?? null,
      wholesaleStatus: WholesaleStatus.PENDING,
      statusChangedAt: new Date(),
    }
    await this.prisma.$transaction(async tx => {
      // Serializes two submissions of the same customer (double click, two tabs).
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${user.id} FOR UPDATE`
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { companyId: true, company: { select: { wholesaleStatus: true } } },
      })
      const blockReason = applyBlockReason(current.company?.wholesaleStatus ?? null)
      if (blockReason) throw new ConflictException(blockReason)
      const owner = await tx.company.findFirst({ where: { cuit: input.cuit }, select: { id: true } })
      if (owner && owner.id !== current.companyId)
        throw new ConflictException('Ese CUIT ya tiene una cuenta. Si es tu empresa, consultá al local para sumarte.')
      // A rejected customer re-applies with the same company row (data may be corrected, even the CUIT).
      const companyId = current.companyId
        ? (await tx.company.update({ where: { id: current.companyId }, data: company, select: { id: true } })).id
        : (await tx.company.create({ data: company, select: { id: true } })).id
      if (!current.companyId) await tx.user.update({ where: { id: user.id }, data: { companyId } })
      await tx.wholesaleApplication.create({
        data: { companyId, submittedById: user.id, message: input.message ?? null },
      })
    })
    return this.mine(user)
  }
}
