import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { StoredFileResponseDto } from './dto/stored-file-response.dto'
import { MAX_IMAGE_BYTES } from './files.constants'
import { FilesService, type UploadedFileInput } from './files.service'

@Controller('admin/files')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminFilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Multer keeps the file in memory (max 5 MB) so its bytes can be checked before anything touches the disk.
   * Browsers send file names in UTF-8; Multer's latin1 default would turn "Impresión" into "ImpresiÃ³n".
   */
  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 }, defParamCharset: 'utf8' }),
  )
  async uploadImage(
    @UploadedFile() file: UploadedFileInput | undefined,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<StoredFileResponseDto> {
    if (!file) throw new BadRequestException('Send the image in the "file" field')
    const stored = await this.filesService.storePublicImage(file, actor.userId)
    await this.auditLogs.record(actor, {
      action: 'file.upload',
      entityType: 'StoredFile',
      entityId: stored.id,
      changes: null,
    })
    return stored
  }
}
