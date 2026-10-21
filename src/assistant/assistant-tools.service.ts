import { HttpException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { AssistantCatalogService } from './assistant-catalog.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import type { ToolResult } from './assistant-model'
import type { AssistantDisplay } from './dto/assistant-stream.dto'
import { whatsappLink, whatsappNumber } from './lib/assistant-limits'
import {
  contactArguments,
  productSlugArgument,
  questionArgument,
  searchArguments,
  shownSlugsArgument,
} from './lib/assistant-tools'

export interface ToolContext {
  conversationId: number
  user: AuthenticatedUser | undefined
}

/** Runs the tools the model calls. Failures go back to the model as an error it can explain or work around. */
@Injectable()
export class AssistantToolsService {
  private readonly logger = new Logger(AssistantToolsService.name)
  private readonly whatsapp: string | null

  constructor(
    private readonly catalog: AssistantCatalogService,
    private readonly conversations: AssistantConversationsService,
    config: ConfigService,
  ) {
    this.whatsapp = whatsappNumber(config.get<string>('ASSISTANT_WHATSAPP_NUMBER'))
  }

  async run(name: string, args: unknown, context: ToolContext): Promise<ToolResult<AssistantDisplay>> {
    try {
      return await this.dispatch(name, args, context)
    } catch (error) {
      // Our own messages (an unknown category…) help the model correct itself; anything else is just logged.
      if (error instanceof HttpException && error.getStatus() < 500) return { output: { error: error.message } }
      this.logger.error(`Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
      return { output: { error: 'No se pudo consultar ahora. No inventes el dato: ofrecé contactar al equipo.' } }
    }
  }

  private async dispatch(name: string, args: unknown, context: ToolContext): Promise<ToolResult<AssistantDisplay>> {
    switch (name) {
      case 'search_products':
        return { output: await this.catalog.search(searchArguments(args), context.user) }
      case 'get_product': {
        const slug = productSlugArgument(args)
        const sheet = slug ? await this.catalog.sheet(slug, context.user) : null
        return { output: sheet ?? { error: 'No hay un producto publicado con ese slug. Buscalo con search_products.' } }
      }
      case 'show_products':
        return this.showProducts(shownSlugsArgument(args), context)
      case 'contact_team':
        return this.contactTeam(args, context)
      case 'record_unanswered_question': {
        const question = questionArgument(args)
        if (question) await this.conversations.recordUnanswered(context.conversationId, question)
        return { output: { recorded: Boolean(question) } }
      }
      default:
        return { output: { error: `La herramienta ${name} no existe.` } }
    }
  }

  private async showProducts(slugs: string[], context: ToolContext): Promise<ToolResult<AssistantDisplay>> {
    const cards = slugs.length ? await this.catalog.cards(slugs, context.user) : []
    const missing = slugs.filter(slug => !cards.some(card => card.slug === slug))
    if (!cards.length) return { output: { shown: [], missing, error: 'Ninguno de esos productos está publicado.' } }
    return {
      output: { shown: cards.map(card => card.name), missing },
      display: { type: 'products', items: cards },
    }
  }

  private async contactTeam(args: unknown, context: ToolContext): Promise<ToolResult<AssistantDisplay>> {
    const contact = contactArguments(args)
    if (!contact) return { output: { error: 'Falta el mensaje para el equipo.' } }
    if (!this.whatsapp)
      return {
        output: {
          available: false,
          note: 'Todavía no hay un canal de contacto publicado. Decile que por ahora no podés derivarlo y ayudalo con lo que tengas.',
        },
      }
    await this.conversations.escalate(context.conversationId, contact.reason)
    return {
      output: { available: true, note: 'El cliente ve un botón para escribirle al equipo por WhatsApp.' },
      display: { type: 'handoff', url: whatsappLink(this.whatsapp, contact.message) },
    }
  }
}
