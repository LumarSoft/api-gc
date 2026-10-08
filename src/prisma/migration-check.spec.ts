import { pendingMigrations, pendingMigrationsMessage } from './migration-check'

describe('migration check', () => {
  it('lists the folders the database has not applied, oldest first', () => {
    expect(
      pendingMigrations(
        ['20261008180000_rework_activity_events', '20261003041338_init_schema', '20261005000000_guest_orders'],
        ['20261003041338_init_schema'],
      ),
    ).toEqual(['20261005000000_guest_orders', '20261008180000_rework_activity_events'])
    expect(pendingMigrations(['20261003041338_init_schema'], ['20261003041338_init_schema'])).toEqual([])
  })

  it('says how to fix it in development and production', () => {
    const message = pendingMigrationsMessage(['20261008180000_rework_activity_events'])
    expect(message).toContain('20261008180000_rework_activity_events')
    expect(message).toContain('npx prisma migrate deploy')
    expect(message).toContain('npx prisma migrate dev')
  })
})
