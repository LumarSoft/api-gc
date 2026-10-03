/**
 * Creates (or promotes) an admin user. Credentials come from environment variables, never from a file in the repo:
 *
 *   ADMIN_EMAIL=ana@example.com ADMIN_PASSWORD='...' ADMIN_FIRST_NAME=Ana ADMIN_LAST_NAME=Pérez npm run admin:create
 */
import 'dotenv/config'
import { Logger } from '@nestjs/common'
import { hash } from 'bcryptjs'
import { UserRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from '../auth/dto/password.constraints'

const logger = new Logger('CreateAdmin')

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  const firstName = process.env.ADMIN_FIRST_NAME?.trim() || 'Admin'
  const lastName = process.env.ADMIN_LAST_NAME?.trim() || 'CG'

  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required')
  if (password.length < PASSWORD_MIN_LENGTH || !PASSWORD_PATTERN.test(password)) {
    throw new Error(`ADMIN_PASSWORD needs ${PASSWORD_MIN_LENGTH}+ characters with at least one letter and one number`)
  }

  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const passwordHash = await hash(password, 12)
    const user = await prisma.user.upsert({
      where: { email },
      update: { role: UserRole.ADMIN, passwordHash, isActive: true, deletedAt: null },
      create: { email, passwordHash, firstName, lastName, role: UserRole.ADMIN, emailVerifiedAt: new Date() },
      select: { id: true, email: true },
    })
    logger.log(`Admin ready: ${user.email} (id ${user.id})`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
