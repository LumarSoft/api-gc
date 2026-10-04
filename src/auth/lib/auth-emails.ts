import type { MailMessage } from '../../mail/mail.service'

type Recipient = { id: number; email: string; firstName: string }

export function emailVerificationMessage(user: Recipient, link: string): MailMessage {
  return {
    to: user.email,
    template: 'email-verification',
    subject: 'Confirmá tu email',
    text: `Hola ${user.firstName}, gracias por crear tu cuenta. Confirmá tu email entrando a:\n${link}`,
    relatedEntity: 'User',
    relatedId: user.id,
  }
}

export function passwordResetMessage(user: Recipient, link: string): MailMessage {
  return {
    to: user.email,
    template: 'password-reset',
    subject: 'Restablecé tu contraseña',
    text: `Hola ${user.firstName}, para elegir una nueva contraseña entrá a:\n${link}\n\nEl enlace vence en 1 hora. Si no lo pediste, ignorá este correo.`,
    relatedEntity: 'User',
    relatedId: user.id,
  }
}
