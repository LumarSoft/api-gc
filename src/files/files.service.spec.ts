import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaService } from '../prisma/prisma.service'
import { FilesService } from './files.service'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('FilesService.storePublicImage', () => {
  let root: string
  const prisma = { storedFile: { findFirst: jest.fn(), create: jest.fn() } }
  const config = { get: (key: string) => ({ STORAGE_DIR: root, PUBLIC_FILES_URL: 'http://api/files/' })[key] }
  const service = (): FilesService =>
    new FilesService(config as unknown as ConfigService, prisma as unknown as PrismaService)

  beforeEach(async () => {
    jest.resetAllMocks()
    root = await mkdtemp(join(tmpdir(), 'files-'))
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('rejects files that are not images, whatever their name', async () => {
    await expect(
      service().storePublicImage({ buffer: Buffer.from('<svg/>'), originalname: 'foto.png' }, 1),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.storedFile.create).not.toHaveBeenCalled()
  })

  it('returns the existing file when the same image was already uploaded', async () => {
    const existing = { id: 9, storageKey: 'uploads/a.png', originalName: 'a.png', mimeType: 'image/png', sizeBytes: 11 }
    prisma.storedFile.findFirst.mockResolvedValue(existing)

    const result = await service().storePublicImage({ buffer: PNG, originalname: 'otra.png' }, 1)

    expect(result).toEqual({
      id: 9,
      url: 'http://api/files/uploads/a.png',
      originalName: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 11,
    })
    expect(prisma.storedFile.create).not.toHaveBeenCalled()
  })

  it('writes a new image under uploads/<year>/<month>/ with its detected type', async () => {
    prisma.storedFile.findFirst.mockResolvedValue(null)
    prisma.storedFile.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }))

    const result = await service().storePublicImage({ buffer: PNG, originalname: 'l3250.jpg' }, 7)

    const data = (prisma.storedFile.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data
    expect(data).toMatchObject({ mimeType: 'image/png', sizeBytes: PNG.length, uploadedById: 7, visibility: 'PUBLIC' })
    expect(data.storageKey).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/)
    expect(result.url).toBe(`http://api/files/${data.storageKey as string}`)
    await expect(readFile(join(root, 'public', data.storageKey as string))).resolves.toEqual(PNG)
  })
})
