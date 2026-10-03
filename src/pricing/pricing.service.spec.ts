import { Test } from '@nestjs/testing'
import { Prisma } from '../generated/prisma/client'
import { BuyerType, Currency, UserRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { PricingService, type PriceContext, type VariantPriceRow } from './pricing.service'

const RETAIL_LIST = 1
const WHOLESALE_LIST = 2
const COMPANY_LIST = 3

function row(priceListId: number, amount: string, currency: Currency, compareAt?: string): VariantPriceRow {
  return {
    priceListId,
    amount: new Prisma.Decimal(amount),
    currency,
    compareAtAmount: compareAt ? new Prisma.Decimal(compareAt) : null,
  }
}

describe('PricingService', () => {
  let service: PricingService
  const prisma = {
    priceList: { findMany: jest.fn() },
    company: { findUnique: jest.fn() },
    exchangeRate: { findFirst: jest.fn() },
  }

  beforeEach(async () => {
    jest.resetAllMocks()
    prisma.priceList.findMany.mockResolvedValue([
      { id: RETAIL_LIST, audience: BuyerType.RETAIL },
      { id: WHOLESALE_LIST, audience: BuyerType.WHOLESALE },
    ])
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('1450.5') })

    const moduleRef = await Test.createTestingModule({
      providers: [PricingService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = moduleRef.get(PricingService)
  })

  describe('getContext', () => {
    it('uses only the retail list for anonymous visitors', async () => {
      const context = await service.getContext(undefined)
      expect(context.priceListIds).toEqual([RETAIL_LIST])
      expect(prisma.company.findUnique).not.toHaveBeenCalled()
    })

    it("prefers the company's own list for wholesale buyers, then falls back to retail", async () => {
      prisma.company.findUnique.mockResolvedValue({ priceListId: COMPANY_LIST })
      const context = await service.getContext({
        id: 1,
        email: 'a@b.com',
        role: UserRole.CUSTOMER,
        buyerType: BuyerType.WHOLESALE,
        companyId: 9,
      })
      expect(context.priceListIds).toEqual([COMPANY_LIST, RETAIL_LIST])
    })

    it('uses the default wholesale list when the company has none', async () => {
      prisma.company.findUnique.mockResolvedValue({ priceListId: null })
      const context = await service.getContext({
        id: 1,
        email: 'a@b.com',
        role: UserRole.CUSTOMER,
        buyerType: BuyerType.WHOLESALE,
        companyId: 9,
      })
      expect(context.priceListIds).toEqual([WHOLESALE_LIST, RETAIL_LIST])
    })
  })

  describe('resolve', () => {
    const withRate: PriceContext = {
      priceListIds: [WHOLESALE_LIST, RETAIL_LIST],
      usdRate: new Prisma.Decimal('1450.5'),
    }

    it('picks the first list that has a price', () => {
      const result = service.resolve([row(RETAIL_LIST, '100.00', Currency.ARS)], withRate)
      expect(result?.price).toEqual({ amount: '100.00', currency: Currency.ARS })
    })

    it('converts USD to ARS with decimal math and rounds to cents', () => {
      const result = service.resolve([row(WHOLESALE_LIST, '10.33', Currency.USD, '12.00')], withRate)
      // 10.33 × 1450.5 = 14983.665 → 14983.67 (a float would give 14983.664999…)
      expect(result?.price).toEqual({ amount: '14983.67', currency: Currency.ARS })
      expect(result?.compareAtPrice).toEqual({ amount: '17406.00', currency: Currency.ARS })
    })

    it('keeps USD when there is no exchange rate instead of showing a wrong peso amount', () => {
      const result = service.resolve([row(RETAIL_LIST, '990.00', Currency.USD)], { ...withRate, usdRate: null })
      expect(result?.price).toEqual({ amount: '990.00', currency: Currency.USD })
    })

    it('returns null when no applicable list has a price', () => {
      expect(service.resolve([row(COMPANY_LIST, '1.00', Currency.ARS)], withRate)).toBeNull()
    })
  })
})
