import { type AdminCategoryRow, buildCategoryTree } from './category-tree'

const row = (id: number, parentId: number | null, products = 0): AdminCategoryRow => ({
  id,
  parentId,
  name: `C${id}`,
  slug: `c${id}`,
  description: null,
  imageFileId: id === 1 ? 10 : null,
  imageFile: id === 1 ? { storageKey: 'uploads/a.png' } : null,
  sortOrder: 0,
  isActive: true,
  _count: { products },
})

describe('buildCategoryTree', () => {
  it('nests subcategories under their parent, keeping the given order', () => {
    const tree = buildCategoryTree([row(1, null), row(2, 1, 4), row(3, null), row(4, 1)], key => `/files/${key}`)
    expect(tree.map(node => node.id)).toEqual([1, 3])
    expect(tree[0].children.map(node => node.id)).toEqual([2, 4])
    expect(tree[0].children[0].productCount).toBe(4)
    expect(tree[0].imageUrl).toBe('/files/uploads/a.png')
  })

  it('keeps a subcategory whose parent is not in the list visible at the top', () => {
    expect(buildCategoryTree([row(2, 99)], key => key).map(node => node.id)).toEqual([2])
  })
})
