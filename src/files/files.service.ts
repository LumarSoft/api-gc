import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { FileVisibility } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { StoredFileResponseDto } from './dto/stored-file-response.dto'
import { PUBLIC_FILES_FOLDER, UPLOADS_FOLDER } from './files.constants'
import { detectImageType } from './lib/image-signature'

/** The part of an uploaded file this service needs (Multer's file object has more). */
export interface UploadedFileInput {
  buffer: Buffer
  originalname: string
}

/**
 * Local disk storage for uploaded files.
 * TODO(storage): move to object storage (S3-compatible) before running more than one API instance.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Absolute path of the storage root (STORAGE_DIR, default ./storage). */
  storageRoot(): string {
    return resolve(this.config.get<string>('STORAGE_DIR') ?? 'storage')
  }

  /** Public URL of a PUBLIC file, built from its storage key. */
  publicUrl(storageKey: string): string {
    const base = (this.config.get<string>('PUBLIC_FILES_URL') ?? 'http://localhost:3001/files').replace(/\/+$/, '')
    return `${base}/${storageKey}`
  }

  /** Copies a local file into public storage under `storageKey` (used by seeds and imports). */
  async copyIntoPublic(sourcePath: string, storageKey: string): Promise<void> {
    const target = this.publicPath(storageKey)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(sourcePath, target)
  }

  /**
   * Stores an image for the catalog (product photos, brand logos, category images). The type is read from the file's
   * bytes; anything that is not JPEG, PNG, WebP or AVIF is rejected. Uploading the same image twice returns the
   * existing file instead of storing a copy.
   */
  async storePublicImage(file: UploadedFileInput, uploadedById: number): Promise<StoredFileResponseDto> {
    const type = detectImageType(file.buffer)
    if (!type) throw new BadRequestException('The file must be a JPG, PNG, WebP or AVIF image')

    const checksum = createHash('sha256').update(file.buffer).digest('hex')
    const existing = await this.prisma.storedFile.findFirst({
      where: { checksum, visibility: FileVisibility.PUBLIC, deletedAt: null },
      select: STORED_FILE_SELECT,
    })
    if (existing) return this.toResponse(existing)

    const now = new Date()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const storageKey = `${UPLOADS_FOLDER}/${now.getUTCFullYear()}/${month}/${randomUUID()}.${type.extension}`
    const target = this.publicPath(storageKey)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.buffer)

    try {
      const stored = await this.prisma.storedFile.create({
        data: {
          storageKey,
          originalName: file.originalname.slice(0, 255),
          mimeType: type.mimeType,
          sizeBytes: file.buffer.length,
          checksum,
          visibility: FileVisibility.PUBLIC,
          uploadedById,
        },
        select: STORED_FILE_SELECT,
      })
      return this.toResponse(stored)
    } catch (error) {
      // Without its row the file would be an orphan on disk that nothing points to.
      await unlink(target).catch(() => undefined)
      throw error
    }
  }

  private publicPath(storageKey: string): string {
    return join(this.storageRoot(), PUBLIC_FILES_FOLDER, storageKey)
  }

  private toResponse(file: StoredFileRow): StoredFileResponseDto {
    return {
      id: file.id,
      url: this.publicUrl(file.storageKey),
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    }
  }
}

const STORED_FILE_SELECT = { id: true, storageKey: true, originalName: true, mimeType: true, sizeBytes: true } as const

type StoredFileRow = { id: number; storageKey: string; originalName: string; mimeType: string; sizeBytes: number }
