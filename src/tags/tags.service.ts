import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TagResponseDto } from './dto/tag-response.dto'
import { TAG_ORDER, TAG_SELECT } from './lib/tag-select'

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tags for catalog filters. A short, bounded list: no pagination. */
  findAll(group: string | undefined): Promise<TagResponseDto[]> {
    return this.prisma.tag.findMany({
      where: { deletedAt: null, group },
      orderBy: TAG_ORDER,
      select: TAG_SELECT,
    })
  }
}
