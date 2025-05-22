import type { Redemption, RedemptionStatus } from '../types/Redemption.type.js';
import logger from './Logger.js';
import { ethers } from 'ethers';
import { prisma } from '../utils/prisma.js';

function serializeRedemption(redemption: Redemption): any {
  const r = JSON.parse(JSON.stringify(redemption));
  if (r.event) {
    if (r.event.amount && ethers.BigNumber.isBigNumber(r.event.amount)) {
      r.event.amount = r.event.amount.toString();
    }
    if (
      r.event.mainUtxo &&
      r.event.mainUtxo.txOutputValue &&
      ethers.BigNumber.isBigNumber(r.event.mainUtxo.txOutputValue)
    ) {
      r.event.mainUtxo.txOutputValue = r.event.mainUtxo.txOutputValue.toString();
    }
  }
  return r;
}

function deserializeRedemption(dataBlob: any): Omit<Redemption, 'id' | 'chainId' | 'status'> {
  const partial: any = { ...dataBlob };

  if (partial.event) {
    if (partial.event.amount && typeof partial.event.amount === 'string') {
      partial.event.amount = ethers.BigNumber.from(partial.event.amount);
    }
    // txOutputValue in mainUtxo is intended to be a string representing BigNumber,
    // so no further deserialization needed here for it.
  }
  
  // Remove properties that are now top-level in Prisma model to avoid conflicts
  // and ensure we use the authoritative top-level values.
  delete partial.id;
  delete partial.chainId;
  delete partial.status;

  return partial as Omit<Redemption, 'id' | 'chainId' | 'status'>;
}

export class RedemptionStore {
  static async create(redemption: Redemption): Promise<void> {
    try {
      await prisma.redemption.create({
        data: {
          id: redemption.id,
          chainId: redemption.chainId,
          status: redemption.status.toString(),
          data: serializeRedemption(redemption),
        },
      });
        logger.info(`Redemption created: ${redemption.id}`);
      } catch (err: any) {
      if (err.code === 'P2002') {
          logger.warn(`Redemption already exists: ${redemption.id}`);
        } else {
          logger.error(`Failed to create redemption ${redemption.id}: ${err}`);
          throw err;
        }
      }
  }

  static async update(redemption: Redemption): Promise<void> {
    try {
      await prisma.redemption.update({
        where: { id: redemption.id },
        data: {
          chainId: redemption.chainId,
          status: redemption.status.toString(),
          data: serializeRedemption(redemption),
        },
      });
        logger.info(`Redemption updated: ${redemption.id}`);
      } catch (err) {
        logger.error(`Failed to update redemption ${redemption.id}: ${err}`);
        throw err;
      }
  }

  static async getById(id: string): Promise<Redemption | null> {
    try {
      const record = await prisma.redemption.findUnique({ where: { id } });
      if (!record) return null;
      
      const deserializedBlobParts = deserializeRedemption(record.data);
      
      return {
        id: record.id,
        chainId: record.chainId,
        status: record.status as unknown as RedemptionStatus,
        ...deserializedBlobParts,
      } as Redemption; // Cast to Redemption after combining all parts
    } catch (err) {
      logger.error(`Failed to read redemption ${id}: ${err}`);
      throw err;
    }
  }

  static async getAll(): Promise<Redemption[]> {
      try {
      const records = await prisma.redemption.findMany();
      return records.map((record: any) => {
        const deserializedBlobParts = deserializeRedemption(record.data);
        return {
          id: record.id,
          chainId: record.chainId,
          status: record.status as unknown as RedemptionStatus,
          ...deserializedBlobParts,
        } as Redemption;
      });
      } catch (err) {
      logger.error(`Failed to fetch all redemptions: ${err}`);
      return [];
    }
  }

  static async getByStatus(status: RedemptionStatus, chainId?: string): Promise<Redemption[]> {
    try {
      const whereClause: any = { status: status.toString() };
      if (chainId) {
        whereClause.chainId = chainId;
      }
      const records = await prisma.redemption.findMany({ where: whereClause });
      return records.map((record: any) => {
        const deserializedBlobParts = deserializeRedemption(record.data);
        return {
          id: record.id,
          chainId: record.chainId,
          status: record.status as unknown as RedemptionStatus,
          ...deserializedBlobParts,
        } as Redemption;
      });
    } catch (err) {
      logger.error(`Failed to fetch redemptions by status${chainId ? ` for chain ${chainId}` : ''}: ${err}`);
      return [];
    }
  }

  static async delete(id: string): Promise<void> {
      try {
      await prisma.redemption.delete({ where: { id } });
        logger.info(`Redemption deleted: ${id}`);
      } catch (err: any) {
      if (err.code === 'P2025') {
          logger.warn(`Redemption not found for delete: ${id}`);
        } else {
          logger.error(`Failed to delete redemption ${id}: ${err}`);
          throw err;
        }
      }
  }
}