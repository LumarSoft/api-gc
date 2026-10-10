import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { hashToken } from '../common/utils/secure-token'
import { OrderStatus, PaymentMethod } from '../generated/prisma/enums'
import { PAYMENT_GATEWAY, PaymentGatewayError, type PaymentGateway } from '../mercado-pago/payment-gateway'
import type { OrderResponseDto } from '../orders/dto/order-response.dto'
import { MERCADO_PAGO_CLOSING_MINUTES } from '../orders/lib/reservation-hours'
import { OrdersService } from '../orders/orders.service'
import { PrismaService } from '../prisma/prisma.service'
import type { MercadoPagoCheckoutResponseDto } from './dto/mercado-pago-checkout-response.dto'
import { checkoutLines } from './lib/checkout-lines'
import { payableOrderSelect, type PayableOrderRow } from './lib/payment-selects'
import { PaymentSyncService } from './payment-sync.service'

/** Starting a payment needs this much time left before the checkout closes. */
const MIN_TIME_TO_PAY_MS = 60_000

/**
 * The buyer's side of paying an order with Mercado Pago, authorized by the order's private access token: the
 * checkout link, and reading the payment again when they come back.
 */
@Injectable()
export class MercadoPagoCheckoutService {
  private readonly logger = new Logger(MercadoPagoCheckoutService.name)
  private readonly frontUrl: string

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentSyncService,
    private readonly orders: OrdersService,
    config: ConfigService,
  ) {
    this.frontUrl = (config.get<string>('FRONT_URL') ?? '').replace(/\/+$/, '')
  }

  /** A new Mercado Pago checkout for the order total, closing before the stock reservation ends. */
  async checkout(number: string, accessToken: string): Promise<MercadoPagoCheckoutResponseDto> {
    const order = await this.order(number, accessToken)
    if (order.paymentMethod !== PaymentMethod.MERCADO_PAGO)
      throw new UnprocessableEntityException('Este pedido se paga coordinando con el local.')
    if (order.status !== OrderStatus.PENDING_PAYMENT)
      throw new UnprocessableEntityException('Este pedido ya no espera un pago.')
    if (!this.gateway.configured) throw this.unavailable()
    // A payment approved but not yet notified must not be paid twice.
    if ((await this.provider(order, () => this.sync(order))) !== OrderStatus.PENDING_PAYMENT)
      throw new UnprocessableEntityException('Este pedido ya no espera un pago.')
    const closesAt = new Date(order.expiresAt!.getTime() - MERCADO_PAGO_CLOSING_MINUTES * 60_000)
    if (closesAt.getTime() - Date.now() < MIN_TIME_TO_PAY_MS)
      throw new UnprocessableEntityException('La reserva de este pedido está por vencer. Hacé un pedido nuevo.')
    const checkoutUrl = await this.provider(order, () =>
      this.gateway.createCheckout({
        reference: order.number,
        lines: checkoutLines(order),
        payer: { name: order.addresses[0]?.name ?? '', email: order.contactEmail },
        returnUrl: `${this.frontUrl}/pedidos/${order.number}/pago`,
        expiresAt: closesAt,
      }),
    )
    return { checkoutUrl }
  }

  /**
   * Reads the order's payments from Mercado Pago (never from the redirect) and returns the tracking view. When
   * Mercado Pago does not answer, the order is returned as stored: the webhook will bring the payment.
   */
  async refresh(number: string, accessToken: string): Promise<OrderResponseDto> {
    const order = await this.order(number, accessToken)
    if (order.paymentMethod === PaymentMethod.MERCADO_PAGO && this.gateway.configured)
      await this.sync(order).catch(() => this.logger.warn(`Could not read the payments of order ${order.id}`))
    return this.orders.track(number, accessToken)
  }

  private async sync(order: PayableOrderRow): Promise<OrderStatus> {
    const payments = await this.gateway.findPayments(order.number)
    return this.payments.recordAll(order.id, order.status, payments)
  }

  private async order(number: string, accessToken: string): Promise<PayableOrderRow> {
    const order = await this.prisma.order.findFirst({
      where: { number, accessTokenHash: hashToken(accessToken) },
      select: payableOrderSelect,
    })
    if (!order) throw new NotFoundException('No encontramos un pedido con este enlace privado.')
    return order
  }

  /** A provider call whose failure means "try again later" to the buyer. */
  private async provider<T>(order: PayableOrderRow, call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (!(error instanceof PaymentGatewayError)) throw error
      this.logger.error(`Mercado Pago failed while starting the payment of order ${order.id} (${error.kind})`)
      throw this.unavailable()
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException('Mercado Pago no responde. Probá de nuevo en unos minutos.')
  }
}
