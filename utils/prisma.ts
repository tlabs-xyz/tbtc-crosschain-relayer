import { PrismaClient as PrismaClientProd } from '@prisma/client';

// In production builds we avoid statically importing '@prisma/client-test'
// because it is not generated/installed. In tests, fall back to requiring it
// dynamically if available, otherwise use the prod client.
function createPrismaClient() {
  if (process.env.NODE_ENV === 'test') {
    try {
      const { PrismaClient: PrismaClientTest } = require('@prisma/client-test');
      return new PrismaClientTest();
    } catch (_err) {
      return new PrismaClientProd();
    }
  }

  return new PrismaClientProd();
}

export const prisma = createPrismaClient();
