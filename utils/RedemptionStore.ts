import type { Redemption, RedemptionStatus } from '../types/Redemption.type.js';
import logger, { logErrorContext } from './Logger.js';
import { ethers } from 'ethers';
import { prisma } from '../utils/prisma.js';

// It's better to define this in a shared errors file and import it
export class VersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionMismatchError';
  }
}

function serializeRedemptionData(redemption: Redemption): any {
  // Clone the redemption object and remove top-level fields that are separate columns in Prisma
  const dataBlob: Partial<Redemption> = { ...redemption };
  delete dataBlob.id;
  delete dataBlob.chainName;
  delete dataBlob.status;
  delete dataBlob.version; // Ensure version is not part of the JSON blob

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

function deserializeRedemptionData(dataBlob: any): Omit<Redemption, 'id' | 'chainName' | 'status' | 'version'> {
  const partial: any = { ...dataBlob }; // Clone the data blob from DB

  if (partial.event) {
    if (partial.event.amount && typeof partial.event.amount === 'string') {
      partial.event.amount = ethers.BigNumber.from(partial.event.amount);
    }
    // txOutputValue in mainUtxo is intended to be a string representing BigNumber,
    // so no further deserialization needed here for it.
  }
  // id, chainName, status, version are already top-level, so dataBlob doesn't contain them directly.
  return partial as Omit<Redemption, 'id' | 'chainName' | 'status' | 'version'>;
}

export class RedemptionStore {
  static async create(redemption: Omit<Redemption, 'version'> & { version?: number }): Promise<void> {
    try {
      // Prisma handles the default version: 1 from schema
      await prisma.redemption.create({
        data: {
          id: redemption.id,
          chainName: redemption.chainName,
          status: redemption.status.toString(),
          data: serializeRedemptionData(redemption as Redemption), // Pass the full object for serialization logic
          // version will be defaulted by Prisma
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
    if (typeof redemption.version !== 'number') {
      const errMsg = `Redemption update for ${redemption.id} is missing version number. Optimistic locking requires version.`;
      logger.error(errMsg);
      throw new Error(errMsg);
    }
    try {
      const result = await prisma.redemption.updateMany({
        where: {
          id: redemption.id,
          version: redemption.version,
        },
        data: {
          chainName: redemption.chainName,
          status: redemption.status.toString(),
          data: serializeRedemptionData(redemption),
          version: redemption.version + 1,
        },
      });

      if (result.count === 0) {
        const existingRedemption = await prisma.redemption.findUnique({ where: { id: redemption.id } });
        if (existingRedemption) {
          throw new VersionMismatchError(
            `Redemption ${redemption.id} update failed due to version mismatch. Expected ${redemption.version}, found ${existingRedemption.version}.`,
          );
        } else {
          throw new Error(
            `Redemption ${redemption.id} update failed. Record not found (it may have been deleted).`,
          );
        }
      }
      logger.info(`Redemption updated: ${redemption.id} to version ${redemption.version + 1}`);
    } catch (err) {
      if (err instanceof VersionMismatchError) {
        logErrorContext(`Version mismatch for redemption ${redemption.id}:`, err);
        throw err;
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
        chainName: record.chainName,
        status: record.status as unknown as RedemptionStatus,
        version: record.version, // Add version from the top-level field
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
          chainName: record.chainName,
          status: record.status as unknown as RedemptionStatus,
          version: record.version, // Add version
          ...deserializedBlobParts,
        } as Redemption;
      });
    } catch (err) {
      logErrorContext(`Failed to fetch all redemptions:`, err);
      throw err; // Or return []
    }
  }

  static async getByStatus(status: RedemptionStatus, chainName?: string): Promise<Redemption[]> {
    try {
      const whereClause: any = { status: status.toString() };
      if (chainName) {
        whereClause.chainName = chainName;
      }
      const records = await prisma.redemption.findMany({ where: whereClause });
      return records.map((record: any) => {
        const deserializedBlobParts = deserializeRedemptionData(record.data);
        return {
          id: record.id,
          chainName: record.chainName,
          status: record.status as unknown as RedemptionStatus,
          version: record.version, // Add version
          ...deserializedBlobParts,
        } as Redemption;
      });
    } catch (err) {
      logErrorContext(
        `Failed to fetch redemptions by status ${status}${chainName ? ` for chain ${chainName}` : ''}:`,
        err,
      );
      throw err; // Or return []
    }
  }

  static async delete(id: string): Promise<void> {
    // Deletion doesn't typically need version locking, but one could be added if necessary.
    try {
      await prisma.redemption.delete({ where: { id } });
      logger.info(`Redemption deleted: ${id}`);
    } catch (err: any) {
      if (err.code === 'P2025') { // Record to delete does not exist
        logger.warn(`Redemption not found for delete: ${id}`);
      } else {
        logErrorContext(`Failed to delete redemption ${id}:`, err);
        throw err;
      }
    }
  }
}
