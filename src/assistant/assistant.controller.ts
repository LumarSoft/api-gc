import { Body, Controller, HttpCode, HttpStatus, Ip, Post, Res, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { OptionalUser } from '../common/decorators/optional-user.decorator'
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantService } from './assistant.service'
import { RecordCartAddDto } from './dto/record-cart-add.dto'
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto'

/**
 * The store's sales assistant. Browser-only: per-IP throttling applies, and prices follow the session when present.
 * The answer streams as NDJSON (one `AssistantStreamEvent` per line) so the customer reads it while it is written.
 */
@Controller('assistant')
@UseGuards(OptionalJwtAuthGuard)
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly conversations: AssistantConversationsService,
  ) {}

  @Post('messages')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async send(
    @Body() input: SendAssistantMessageDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Ip() ip: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // Refusals (limits, unknown conversation) are thrown here, before any byte of the stream is sent.
    const conversation = await this.assistant.open(input, user, ip)
    const abort = new AbortController()
    response.on('close', () => {
      if (!response.writableFinished) abort.abort()
    })
    response.status(200)
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    response.setHeader('Cache-Control', 'private, no-store')
    // Nginx buffers proxied responses by default, which would deliver the whole answer at once.
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()
    for await (const event of this.assistant.answer(conversation, input, user, abort.signal)) {
      // The customer may have left: the answer still finishes (or stops) and is recorded.
      if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`)
    }
    response.end()
  }

  /** The customer added a product to the cart from one of the chat's cards: what the assistant sold, for the admin. */
  @Post('cart-adds')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  recordCartAdd(@Body() input: RecordCartAddDto): Promise<void> {
    return this.conversations.recordCartAdd(input.conversation, input.productId, input.variantId)
  }
}
