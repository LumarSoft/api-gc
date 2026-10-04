import { Controller, Get, Query } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { ListTagsQueryDto } from './dto/list-tags-query.dto'
import { TagResponseDto } from './dto/tag-response.dto'
import { TagsService } from './tags.service'

// Public catalog read: the front renders it on its server, where every visitor shares one IP. See docs/rules/security.md.
@SkipThrottle()
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll(@Query() query: ListTagsQueryDto): Promise<TagResponseDto[]> {
    return this.tagsService.findAll(query.group)
  }
}
