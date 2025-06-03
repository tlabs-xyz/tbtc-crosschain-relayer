import { PrismaClient as PrismaClientTest } from '@prisma/client-test';
import { PrismaClient as PrismaClientProd } from '@prisma/client';

// Workaround for TypeScript deep instantiation error in multi-client setups
// Use explicit type assertion to avoid union type complexity
const createPrismaClient = (): PrismaClientProd => {
  if (process.env.NODE_ENV === 'test') {
    return new PrismaClientTest() as PrismaClientProd;
  }
  return new PrismaClientProd();
};

export const prisma = createPrismaClient();
