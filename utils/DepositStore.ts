import type { Deposit } from '../types/Deposit.type.js';
import { type DepositStatus } from '../types/DepositStatus.enum.js';
import logger, { logErrorContext } from './Logger.js';
import { prisma } from '../utils/prisma.js';
import type { JsonValue, InputJsonValue } from '@prisma/client/runtime/library';
import type { ErrorLike, PrismaError } from '../types/Error.types.js';

// Interface for database where clauses
interface DepositWhereClause {
  status?: number;
  chainName?: string;
  id?: string;
  [key: string]: unknown;
}

function serializeDeposit(deposit: Deposit): {
  id: string;
  chainName: string;
  fundingTxHash: string;
  outputIndex: number;
  owner: string;
  status: number;
  error: string | null;
  hashes: InputJsonValue;
  receipt: InputJsonValue;
  L1OutputEvent: InputJsonValue;
  dates: InputJsonValue;
  wormholeInfo: InputJsonValue;
} {
  return {
    id: deposit.id,
    chainName: deposit.chainName,
    fundingTxHash: deposit.fundingTxHash,
    outputIndex: deposit.outputIndex,
    owner: deposit.owner,
    status: deposit.status,
    error: deposit.error || null,
    hashes: deposit.hashes as unknown as InputJsonValue,
    receipt: deposit.receipt as unknown as InputJsonValue,
    L1OutputEvent: (deposit.L1OutputEvent ?? null) as unknown as InputJsonValue,
    dates: deposit.dates as unknown as InputJsonValue,
    wormholeInfo: deposit.wormholeInfo as unknown as InputJsonValue,
  };
}

function deserializeDeposit(record: {
  id: string;
  chainName: string;
  fundingTxHash: string;
  outputIndex: number;
  owner: string;
  status: number;
  error: string | null;
  hashes: JsonValue;
  receipt: JsonValue;
  L1OutputEvent: JsonValue;
  dates: JsonValue;
  wormholeInfo: JsonValue;
}): Deposit {
  return {
    id: record.id,
    chainName: record.chainName,
    fundingTxHash: record.fundingTxHash,
    outputIndex: record.outputIndex,
    owner: record.owner,
    status: record.status as DepositStatus,
    error: record.error,
    hashes: record.hashes as Deposit['hashes'],
    receipt: record.receipt as Deposit['receipt'],
    L1OutputEvent: record.L1OutputEvent as Deposit['L1OutputEvent'],
    dates: record.dates as Deposit['dates'],
    wormholeInfo: record.wormholeInfo as Deposit['wormholeInfo'],
  };
}

export class DepositStore {
  static async create(deposit: Deposit): Promise<void> {
    try {
      await prisma.deposit.create({
        data: serializeDeposit(deposit),
      });
      logger.info(`Deposit created: ${deposit.id}`);
    } catch (err: unknown) {
      const error = err as PrismaError;
      if (error.code === 'P2002') {
        logger.warn(`Deposit already exists: ${deposit.id}`);
      } else {
        logErrorContext(`Failed to create deposit ${deposit.id}:`, err as ErrorLike);
        throw error;
      }
    }
  }

  static async update(deposit: Deposit): Promise<void> {
    try {
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: serializeDeposit(deposit),
      });
      logger.info(`Deposit updated: ${deposit.id}`);
    } catch (err: unknown) {
      logErrorContext(`Failed to update deposit ${deposit.id}:`, err as ErrorLike);
      throw err;
    }
  }

  static async getById(id: string): Promise<Deposit | null> {
    try {
      const record = await prisma.deposit.findUnique({ where: { id } });
      if (!record) return null;
      return deserializeDeposit(record);
    } catch (err: unknown) {
      logErrorContext(`Failed to read deposit ${id}:`, err as ErrorLike);
      throw err;
    }
  }

  static async getAll(): Promise<Deposit[]> {
    try {
      const records = await prisma.deposit.findMany();
      return records.map(deserializeDeposit);
    } catch (err: unknown) {
      logErrorContext(`Failed to fetch all deposits:`, err as ErrorLike);
      return [];
    }
  }

  static async getByStatus(status: DepositStatus, chainName?: string): Promise<Deposit[]> {
    try {
      const whereClause: DepositWhereClause = { status: status };
      if (chainName) {
        whereClause.chainName = chainName;
      }
      const records = await prisma.deposit.findMany({ where: whereClause });
      return records.map(deserializeDeposit);
    } catch (err: unknown) {
      logErrorContext(
        `Failed to fetch deposits by status${chainName ? ` for chain ${chainName}` : ''}:`,
        err as ErrorLike,
      );
      return [];
    }
  }

  static async delete(id: string): Promise<void> {
    try {
      await prisma.deposit.delete({ where: { id } });
      logger.info(`Deposit deleted: ${id}`);
    } catch (err: unknown) {
      const error = err as PrismaError;
      if (error.code === 'P2025') {
        logger.warn(`Deposit not found for delete: ${id}`);
      } else {
        logErrorContext(`Failed to delete deposit ${id}:`, err as ErrorLike);
        throw error;
      }
    }
  }
}
