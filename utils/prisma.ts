import { PrismaClient as PrismaClientTest } from '@prisma/client-test';
import { PrismaClient as PrismaClientProd } from '@prisma/client';

// Simple client creation based on environment
const createPrismaClient = () => {
  if (process.env.NODE_ENV === 'test') {
    return new PrismaClientTest() as any;
  }
  return new PrismaClientProd() as any;
};

// Export the Prisma client instance
export const prisma = createPrismaClient();
