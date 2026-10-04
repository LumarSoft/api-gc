import { ConflictException } from '@nestjs/common'

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** "Papeles & Sustratos fotográficos" → "papeles-sustratos-fotograficos". Accents are dropped, not removed letters. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type SlugOwnership = 'free' | 'restore' | 'conflict'

/**
 * What to do with a slug that must be unique on a soft-deletable table (see docs/rules/database.md):
 * - `free`: nobody else has it.
 * - `restore`: an archived row holds it and a new record is being created → restore and reuse that row.
 * - `conflict`: an active row holds it, or an archived one while editing another record → 409.
 */
export function slugOwnership(
  holder: { id: number; deletedAt: Date | null } | null,
  editingId: number | null,
): SlugOwnership {
  if (!holder || holder.id === editingId) return 'free'
  if (holder.deletedAt && editingId === null) return 'restore'
  return 'conflict'
}

/**
 * Checks a slug before saving it on a soft-deletable table and returns the id of the archived row to restore, if any.
 * `findHolder` looks the slug up including archived rows. Throws 409 when the slug is taken.
 */
export async function claimSlug(
  slug: string,
  findHolder: (slug: string) => Promise<{ id: number; deletedAt: Date | null } | null>,
  editingId: number | null,
): Promise<number | null> {
  const holder = await findHolder(slug)
  const ownership = slugOwnership(holder, editingId)
  if (ownership === 'conflict') {
    throw new ConflictException(
      holder?.deletedAt ? `The slug "${slug}" belongs to an archived record` : `The slug "${slug}" is already in use`,
    )
  }
  return ownership === 'restore' && holder ? holder.id : null
}
