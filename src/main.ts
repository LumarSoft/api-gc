import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

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
