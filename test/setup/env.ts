import { testDatabaseUrl } from './test-database'

// Runs before every suite: PrismaService reads DATABASE_URL, and ConfigModule does not overwrite a variable that is
// already set, so the app under test talks to the test database instead of the one in .env.
process.env.DATABASE_URL = testDatabaseUrl()
