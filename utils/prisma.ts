import { PrismaClient as PrismaClientTest } from '@prisma/client-test';
import { PrismaClient as PrismaClientProd } from '@prisma/client';

// Workaround for TypeScript deep instantiation error in multi-client setups
export const prisma =
  process.env.NODE_ENV === 'test' ? new PrismaClientTest() : (new PrismaClientProd() as any);
