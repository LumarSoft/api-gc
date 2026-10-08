import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ActivityModule } from './activity/activity.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AuditLogsModule } from './audit-logs/audit-logs.module'
import { AuthModule } from './auth/auth.module'
import { BrandsModule } from './brands/brands.module'
import { CategoriesModule } from './categories/categories.module'
import { FilesModule } from './files/files.module'
import { MailModule } from './mail/mail.module'
import { PrismaModule } from './prisma/prisma.module'
import { ProductsModule } from './products/products.module'
import { TagsModule } from './tags/tags.module'
import { CartModule } from './cart/cart.module'
import { CheckoutModule } from './checkout/checkout.module'
import { OrdersModule } from './orders/orders.module'
import { FavoritesModule } from './favorites/favorites.module'
import { WholesaleApplicationsModule } from './wholesale-applications/wholesale-applications.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { SettingsModule } from './settings/settings.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Default rate limit for every route: 100 requests per minute per IP. Sensitive routes use @Throttle; routes the
    // front renders on its server use @SkipThrottle (docs/rules/security.md).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    MailModule,
    AuditLogsModule,
    FilesModule,
    AuthModule,
    CategoriesModule,
    BrandsModule,
    ProductsModule,
    TagsModule,
    CartModule,
    CheckoutModule,
    FavoritesModule,
    WholesaleApplicationsModule,
    DashboardModule,
    AnalyticsModule,
    ActivityModule,
    SettingsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
