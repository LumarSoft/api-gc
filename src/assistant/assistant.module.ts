import { Module } from '@nestjs/common'
import { MercadoPagoModule } from '../mercado-pago/mercado-pago.module'
import { ProductsModule } from '../products/products.module'
import { ShippingModule } from '../shipping/shipping.module'
import { AdminAssistantConversationsService } from './admin-assistant-conversations.service'
import { AdminAssistantQuestionsService } from './admin-assistant-questions.service'
import { AdminAssistantUsageService } from './admin-assistant-usage.service'
import { AdminAssistantController } from './admin-assistant.controller'
import { AdminAssistantMapper } from './admin-assistant.mapper'
import { AssistantCatalogService } from './assistant-catalog.service'
import { AssistantContextService } from './assistant-context.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import { ASSISTANT_MODEL } from './assistant-model'
import { AssistantToolsService } from './assistant-tools.service'
import { AssistantController } from './assistant.controller'
import { AssistantService } from './assistant.service'
import { OpenAiAssistantModel } from './openai/openai-assistant.model'

/**
 * The store's AI sales assistant: catalog tools over the real catalog, with the language model behind `ASSISTANT_MODEL`.
 * Staff read its conversations, unanswered questions and usage under `/admin/assistant`.
 */
@Module({
  imports: [ProductsModule, ShippingModule, MercadoPagoModule],
  controllers: [AssistantController, AdminAssistantController],
  providers: [
    AssistantService,
    AdminAssistantConversationsService,
    AdminAssistantQuestionsService,
    AdminAssistantUsageService,
    AdminAssistantMapper,
    AssistantCatalogService,
    AssistantContextService,
    AssistantConversationsService,
    AssistantToolsService,
    { provide: ASSISTANT_MODEL, useClass: OpenAiAssistantModel },
  ],
})
export class AssistantModule {}
