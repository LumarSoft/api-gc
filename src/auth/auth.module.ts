import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { accessTokenTtlMinutes } from './auth-cookies'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  imports: [
    // Global so JwtAuthGuard can be used by any feature module.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')
        // Fail at boot instead of signing tokens with an empty or default secret.
        if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters long')
        return { secret, signOptions: { expiresIn: `${accessTokenTtlMinutes(config)}m` } }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
