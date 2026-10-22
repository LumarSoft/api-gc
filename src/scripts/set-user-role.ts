/**
 * Changes the role of an existing account, without touching its password: to make a team member a developer, or to
 * take the panel away from someone.
 *
 *   ADMIN_EMAIL=ana@example.com ADMIN_ROLE=DEVELOPER npm run admin:role
 *
 * Roles: CUSTOMER, ADMIN (the store's staff) or DEVELOPER (the team: admin plus the developer-only sections).
 */
import 'dotenv/config'
import { Logger } from '@nestjs/common'
import { UserRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'

const logger = new Logger('SetUserRole')

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const role = Object.values(UserRole).find(value => value === process.env.ADMIN_ROLE?.trim().toUpperCase())
  if (!email || !role)
    throw new Error(`ADMIN_EMAIL and ADMIN_ROLE (${Object.values(UserRole).join(', ')}) are required`)

  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true, role: true } })
    if (!user) throw new Error(`No account with email ${email}`)
    await prisma.user.update({ where: { id: user.id }, data: { role } })
    logger.log(`${email} (id ${user.id}): ${user.role} → ${role}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
