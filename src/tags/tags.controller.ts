import { Controller, Get, Query } from '@nestjs/common'
import { ListTagsQueryDto } from './dto/list-tags-query.dto'
import { TagResponseDto } from './dto/tag-response.dto'
import { TagsService } from './tags.service'

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll(@Query() query: ListTagsQueryDto): Promise<TagResponseDto[]> {
    return this.tagsService.findAll(query.group)
  }
}
