import type { MailMessage } from '../../mail/mail.service'

type Recipient = { id: number; email: string; firstName: string }

export function wholesaleDecisionMessage(
  user: Recipient,
  approved: boolean,
  note: string | null,
  accountUrl: string,
): MailMessage {
  const text = approved
    ? `Hola ${user.firstName}, aprobamos tu cuenta de cliente frecuente. Desde ahora ves tus precios al ingresar.\n${accountUrl}`
    : `Hola ${user.firstName}, revisamos tu solicitud de cliente frecuente y por ahora no pudimos aprobarla.${note ? `\nMotivo: ${note}` : ''}\nPodés ver el detalle y enviar una nueva solicitud desde:\n${accountUrl}`
  return {
    to: user.email,
    template: approved ? 'wholesale-approved' : 'wholesale-rejected',
    subject: approved ? 'Tu cuenta de cliente frecuente está aprobada' : 'Revisamos tu solicitud de cliente frecuente',
    text,
    relatedEntity: 'User',
    relatedId: user.id,
  }
}
