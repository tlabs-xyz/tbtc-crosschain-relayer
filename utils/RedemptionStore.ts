import type { Redemption, RedemptionStatus } from '../types/Redemption.type';
import logger, { logErrorContext } from './Logger';
import { ethers } from 'ethers';
import { prisma } from '../utils/prisma';

function serializeRedemptionData(redemption: Redemption): any {
  // Clone the redemption object and remove top-level fields that are separate columns in Prisma
  const dataBlob: Partial<Redemption> = { ...redemption };
  delete dataBlob.id;
  delete dataBlob.chainId;
  delete dataBlob.status;

  // Handle BigNumber serialization within the remaining dataBlob parts
  const r = JSON.parse(JSON.stringify(dataBlob)); // Basic deep clone for further manipulation
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
  return r; // This is the object to be stored in the 'data' JSON field
}

function deserializeRedemptionData(dataBlob: any): Omit<Redemption, 'id' | 'chainId' | 'status'> {
  const partial: any = { ...dataBlob }; // Clone the data blob from DB

  if (partial.event) {
    if (partial.event.amount && typeof partial.event.amount === 'string') {
      partial.event.amount = ethers.BigNumber.from(partial.event.amount);
    }
    // txOutputValue in mainUtxo is intended to be a string representing BigNumber,
    // so no further deserialization needed here for it.
  }
  // id, chainId, status, are already top-level, so dataBlob doesn't contain them directly.
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
          data: serializeRedemptionData(redemption as Redemption), // Pass the full object for serialization logic
        },
      });
      logger.info(`Redemption created: ${redemption.id}`);
    } catch (err: any) {
      if (err.code === 'P2002') {
        logger.warn(`Redemption already exists: ${redemption.id}`);
      } else {
        logErrorContext(`Failed to create redemption ${redemption.id}:`, err);
        throw err;
      }
    }
  }

  static async update(redemption: Redemption): Promise<void> {
    try {
      const result = await prisma.redemption.update({
        where: {
          id: redemption.id,
        },
        data: {
          chainId: redemption.chainId,
          status: redemption.status.toString(),
          data: serializeRedemptionData(redemption),
        },
      });

      logger.info(`Redemption updated: ${redemption.id}`);
    } catch (err: any) {
      if (err.code === 'P2025') {
        logger.warn(`Redemption ${redemption.id} not found for update.`);
        throw new Error(`Redemption ${redemption.id} update failed. Record not found.`);
      }
      logErrorContext(`Failed to update redemption ${redemption.id}:`, err);
      throw err;
    }
  }

  static async getById(id: string): Promise<Redemption | null> {
    try {
      const record = await prisma.redemption.findUnique({ where: { id } });
      if (!record) return null;

      const deserializedBlobParts = deserializeRedemptionData(record.data);

      return {
        id: record.id,
        chainId: record.chainId,
        status: record.status as unknown as RedemptionStatus,
        ...deserializedBlobParts,
      } as Redemption;
    } catch (err) {
      logErrorContext(`Failed to read redemption ${id}:`, err);
      throw err;
    }
  }

  static async getAll(): Promise<Redemption[]> {
    try {
      const records = await prisma.redemption.findMany();
      return records.map((record: any) => {
        const deserializedBlobParts = deserializeRedemptionData(record.data);
        return {
          id: record.id,
          chainId: record.chainId,
          status: record.status as unknown as RedemptionStatus,
          ...deserializedBlobParts,
        } as Redemption;
      });
    } catch (err) {
      logErrorContext(`Failed to fetch all redemptions:`, err);
      throw err;
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
        const deserializedBlobParts = deserializeRedemptionData(record.data);
        return {
          id: record.id,
          chainId: record.chainId,
          status: record.status as unknown as RedemptionStatus,
          ...deserializedBlobParts,
        } as Redemption;
      });
    } catch (err) {
      logErrorContext(
        `Failed to fetch redemptions by status ${status}${chainId ? ` for chain ${chainId}` : ''}:`,
        err,
      );
      throw err;
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
        logErrorContext(`Failed to delete redemption ${id}:`, err);
        throw err;
      }
    }
  }
}
