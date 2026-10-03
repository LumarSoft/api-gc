import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // Behind a reverse proxy / load balancer the client IP comes from X-Forwarded-For. Without this, rate limits would
  // count every customer as the proxy's single IP. TRUST_PROXY = number of proxy hops in front of the API.
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0)
  if (trustProxy > 0) app.set('trust proxy', trustProxy)

  // CORS_ORIGIN accepts a comma-separated list. Trailing slashes are stripped: the browser's
  // `Origin` header never carries one, so "http://localhost:3000/" would fail every preflight.
  const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  app.use(cookieParser())
  app.enableCors({ origin: corsOrigin, credentials: true })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.enableShutdownHooks()

  const port = process.env.PORT ?? 3001
  await app.listen(port)
  new Logger('Bootstrap').log(`App running on port ${port}`)
}

void bootstrap()
