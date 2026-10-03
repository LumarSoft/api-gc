import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EmailStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'

export interface MailMessage {
  to: string
  /** Template key, stored for traceability, e.g. "password-reset". */
  template: string
  subject: string
  text: string
  relatedEntity?: string
  relatedId?: number
}

/**
 * Single entry point for transactional emails. Every email is recorded in EmailMessage.
 * TODO(mail): plug a real provider (SMTP / transactional API). Until then emails are logged in development and
 * marked FAILED in production so they show up as pending work instead of silently disappearing.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production'

    if (!isProduction) {
      this.logger.log(`[dev email] to=${message.to} subject="${message.subject}"\n${message.text}`)
    } else {
      this.logger.error(`Email not sent (no provider configured): template=${message.template}`)
    }

    try {
      await this.prisma.emailMessage.create({
        data: {
          toEmail: message.to,
          template: message.template,
          subject: message.subject,
          status: isProduction ? EmailStatus.FAILED : EmailStatus.LOGGED,
          error: isProduction ? 'No email provider configured' : null,
          relatedEntity: message.relatedEntity,
          relatedId: message.relatedId,
          sentAt: isProduction ? null : new Date(),
        },
      })
    } catch (error) {
      // Recording the email must never break the flow that triggered it (e.g. a registration).
      this.logger.error(`Could not record email: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
