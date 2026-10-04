/** The category being saved: its id (null when creating) and whether it already has subcategories. */
export interface CategoryNode {
  id: number | null
  hasChildren: boolean
}

/** The requested parent, or null for a top-level category. */
export interface ParentCandidate {
  id: number
  parentId: number | null
}

/**
 * The category tree has two levels (categories and subcategories). Returns why a parent is not allowed, or null.
 * The message is shown to the admin as is.
 */
export function parentError(node: CategoryNode, parent: ParentCandidate | null): string | null {
  if (!parent) return null
  if (parent.id === node.id) return 'A category cannot be its own parent'
  if (parent.parentId !== null) return 'Subcategories cannot have subcategories (two levels only)'
  if (node.hasChildren) return 'A category with subcategories cannot become a subcategory'
  return null
}

/** Why a category cannot be archived, or null. Archiving would leave products or subcategories without a home. */
export function archiveError(counts: { products: number; children: number }): string | null {
  if (counts.children > 0) return 'Move or archive its subcategories first'
  if (counts.products > 0) return 'Move its products to another category first'
  return null
}
