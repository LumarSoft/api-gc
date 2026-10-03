import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Folder (inside STORAGE_DIR) served publicly at /files. Private files will live in a sibling folder. */
export const PUBLIC_FILES_FOLDER = 'public'

/**
 * Local disk storage for uploaded files.
 * TODO(storage): move to object storage (S3-compatible) before running more than one API instance.
 */
@Injectable()
export class FilesService {
  constructor(private readonly config: ConfigService) {}

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
    const target = join(this.storageRoot(), PUBLIC_FILES_FOLDER, storageKey)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(sourcePath, target)
  }
}
