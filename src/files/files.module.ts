import { Global, Module } from '@nestjs/common'
import { AdminFilesController } from './admin-files.controller'
import { FilesService } from './files.service'

@Global()
@Module({
  controllers: [AdminFilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
