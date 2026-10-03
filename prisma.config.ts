import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Not `env('DATABASE_URL')`: that throws when the variable is missing, which breaks
    // `prisma generate` (postinstall) on a fresh clone before `.env` exists.
    url: process.env['DATABASE_URL'],
  },
})
