import { Prisma } from '../../generated/prisma/client'

export const applicationSelect = {
  id: true,
  status: true,
  message: true,
  reviewNote: true,
  createdAt: true,
  reviewedAt: true,
  company: {
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      cuit: true,
      taxCondition: true,
      email: true,
      phone: true,
      wholesaleStatus: true,
    },
  },
  submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.WholesaleApplicationSelect

export type ApplicationRow = Prisma.WholesaleApplicationGetPayload<{ select: typeof applicationSelect }>
