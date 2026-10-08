import { Prisma } from '../../generated/prisma/client'

/**
 * Partial match for the staff list: company names and email, applicant name and email, and the CUIT. A term made only
 * of digits, dashes, dots and spaces is also compared against the stored CUIT digits, so `30-71234567` finds it.
 */
export function applicationSearchWhere(q: string): Prisma.WholesaleApplicationWhereInput {
  const digits = /^[\d\s.-]+$/.test(q) ? q.replace(/\D/g, '') : ''
  return {
    OR: [
      { company: { legalName: { contains: q } } },
      { company: { tradeName: { contains: q } } },
      { company: { email: { contains: q } } },
      { company: { cuit: { contains: digits || q } } },
      { submittedBy: { email: { contains: q } } },
      { submittedBy: { firstName: { contains: q } } },
      { submittedBy: { lastName: { contains: q } } },
    ],
  }
}
