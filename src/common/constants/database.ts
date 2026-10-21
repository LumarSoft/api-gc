/**
 * Largest MySQL INT, the type of every id column. Ids in requests are capped with it: a larger one is a 400 instead of
 * a 500 (Prisma rejects values beyond 64 bits and MySQL refuses to write values beyond INT).
 */
export const MAX_INT_ID = 2_147_483_647
