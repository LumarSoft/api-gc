import { Logger, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import type { Response } from 'express'
import { join, resolve } from 'node:path'
import { AppModule } from './app.module'
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter'

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

  // Public files (product images, logos). Private files are never inside this folder.
  app.useStaticAssets(join(resolve(process.env.STORAGE_DIR ?? 'storage'), 'public'), {
    prefix: '/files/',
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    // Uploaded files are served with the type of their extension; never let the browser guess another one.
    setHeaders: (res: Response) => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
    },
  })
  app.enableCors({ origin: corsOrigin, credentials: true })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))

  app.enableShutdownHooks()

  const port = process.env.PORT ?? 3001
  await app.listen(port, process.env.HOST ?? '0.0.0.0')
  new Logger('Bootstrap').log(`App running on port ${port}`)
}

void bootstrap()
