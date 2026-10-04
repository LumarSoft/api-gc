import { archiveError, parentError } from './category-rules'

describe('category rules', () => {
  it('allows top-level categories and subcategories of a top-level one', () => {
    expect(parentError({ id: null, hasChildren: false }, null)).toBeNull()
    expect(parentError({ id: null, hasChildren: false }, { id: 1, parentId: null })).toBeNull()
    expect(parentError({ id: 5, hasChildren: false }, { id: 1, parentId: null })).toBeNull()
  })

  it('keeps the tree at two levels', () => {
    expect(parentError({ id: 5, hasChildren: false }, { id: 5, parentId: null })).toMatch(/own parent/)
    expect(parentError({ id: null, hasChildren: false }, { id: 2, parentId: 1 })).toMatch(/two levels/)
    expect(parentError({ id: 1, hasChildren: true }, { id: 7, parentId: null })).toMatch(/cannot become/)
  })

  it('only archives empty categories', () => {
    expect(archiveError({ products: 0, children: 0 })).toBeNull()
    expect(archiveError({ products: 0, children: 2 })).toMatch(/subcategories/)
    expect(archiveError({ products: 3, children: 0 })).toMatch(/products/)
  })
})
