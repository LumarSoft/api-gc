/**
 * Keeps the model from saying the same thing twice in one answer. GPT-6 Luna sometimes writes a message twice word for
 * word (a preamble and its final answer, or again after a tool), and the customer would read the question twice. A
 * message is held back only while it reads exactly like an earlier one; once it differs, what was held is let through
 * and the rest streams as usual. One instance per answer.
 */
export class RepeatedMessages {
  private readonly earlier: string[] = []
  private current: { id: string; text: string; held: boolean } | null = null

  /** The part of a message's next delta to show now: empty while the message repeats an earlier one. */
  next(messageId: string, delta: string): string {
    if (this.current && this.current.id !== messageId) this.finish()
    const message = (this.current ??= { id: messageId, text: '', held: true })
    message.text += delta
    if (!message.held) return delta
    const sofar = message.text.trim()
    if (sofar === '' || this.earlier.some(text => text.startsWith(sofar))) return ''
    message.held = false
    return message.text
  }

  /** The message ended: it becomes one to compare the next ones with (unless it was itself a repeat). */
  finish(): void {
    const message = this.current
    this.current = null
    if (message && !message.held) this.earlier.push(message.text.trim())
  }
}
