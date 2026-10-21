import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminAssistantConversationsService } from './admin-assistant-conversations.service'
import { AdminAssistantQuestionsService } from './admin-assistant-questions.service'
import { AdminAssistantUsageService } from './admin-assistant-usage.service'
import {
  ChangeQuestionStatusDto,
  ListAssistantConversationsDto,
  ListUnansweredQuestionsDto,
} from './dto/admin-assistant-input.dto'
import type {
  AdminConversationDto,
  AdminConversationsPageDto,
  AssistantUsageDto,
  QuestionStatusResultDto,
  UnansweredQuestionCountsDto,
  UnansweredQuestionsPageDto,
} from './dto/admin-assistant-response.dto'

/** What customers ask the sales assistant, the questions it could not answer and what it costs. Read-only chats. */
@Controller('admin/assistant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAssistantController {
  constructor(
    private readonly conversations: AdminAssistantConversationsService,
    private readonly questions: AdminAssistantQuestionsService,
    private readonly usage: AdminAssistantUsageService,
  ) {}

  @Get('conversations')
  @Header('Cache-Control', 'private, no-store')
  listConversations(@Query() query: ListAssistantConversationsDto): Promise<AdminConversationsPageDto> {
    return this.conversations.list(query)
  }

  @Get('conversations/:id')
  @Header('Cache-Control', 'private, no-store')
  readConversation(@Param() params: IdParamDto): Promise<AdminConversationDto> {
    return this.conversations.read(params.id)
  }

  @Get('questions')
  @Header('Cache-Control', 'private, no-store')
  listQuestions(@Query() query: ListUnansweredQuestionsDto): Promise<UnansweredQuestionsPageDto> {
    return this.questions.list(query)
  }

  @Get('questions/counts')
  @Header('Cache-Control', 'private, no-store')
  questionCounts(): Promise<UnansweredQuestionCountsDto> {
    return this.questions.counts()
  }

  @Post('questions/status')
  @HttpCode(HttpStatus.OK)
  changeQuestionStatus(
    @Body() input: ChangeQuestionStatusDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<QuestionStatusResultDto> {
    return this.questions.changeStatus(input, actor)
  }

  @Get('usage')
  @Header('Cache-Control', 'private, no-store')
  usageReport(@Query() query: DateRangeQueryDto): Promise<AssistantUsageDto> {
    return this.usage.report(query)
  }
}
