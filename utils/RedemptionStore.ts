import type { Redemption, RedemptionStatus } from '../types/Redemption.type.js';
import logger, { logErrorContext } from './Logger.js';
import { ethers } from 'ethers';
import { prisma } from '../utils/prisma.js';
import type { JsonValue, InputJsonValue } from '@prisma/client/runtime/library';

// Interface for the serialized data blob that gets stored in the database
interface SerializedRedemptionData {
  event?: {
    walletPubKeyHash: string;
    mainUtxo: {
      txHash: string;
      txOutputIndex: number;
      txOutputValue: string;
    };
    redeemerOutputScript: string;
    amount: string; // BigNumber serialized as string
    l2TransactionHash: string;
  };
  vaaBytes?: string | null;
  vaaStatus?: RedemptionStatus;
  l1SubmissionTxHash?: string | null;
  error?: string | null;
  dates?: {
    createdAt: number;
    vaaFetchedAt: number | null;
    l1SubmittedAt: number | null;
    completedAt: number | null;
    lastActivityAt: number;
  };
  logs?: string[];
  [key: string]: unknown; // Index signature for Prisma JSON compatibility
}

function serializeRedemptionData(redemption: Redemption): InputJsonValue {
  // Clone the redemption object and remove top-level fields that are separate columns in Prisma
  const dataBlob: Partial<Redemption> = { ...redemption };
  delete dataBlob.id;
  delete dataBlob.chainId;
  delete dataBlob.status;

  // Handle BigNumber serialization within the remaining dataBlob parts
  const r = JSON.parse(JSON.stringify(dataBlob)) as SerializedRedemptionData; // Basic deep clone for further manipulation
  if (r.event) {
    if (r.event.amount && ethers.BigNumber.isBigNumber(dataBlob.event?.amount)) {
      r.event.amount = (dataBlob.event.amount as ethers.BigNumber).toString();
    }
    if (
      r.event.mainUtxo &&
      r.event.mainUtxo.txOutputValue &&
      dataBlob.event?.mainUtxo &&
      ethers.BigNumber.isBigNumber(dataBlob.event.mainUtxo.txOutputValue)
    ) {
      r.event.mainUtxo.txOutputValue = (
        dataBlob.event.mainUtxo.txOutputValue as ethers.BigNumber
      ).toString();
    }
  }
  return r as InputJsonValue; // This is the object to be stored in the 'data' JSON field
}

function isSerializedRedemptionData(data: JsonValue): data is SerializedRedemptionData & JsonValue {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function deserializeRedemptionData(
  dataBlob: JsonValue,
): Omit<Redemption, 'id' | 'chainId' | 'status'> {
  if (!isSerializedRedemptionData(dataBlob)) {
    throw new Error('Invalid serialized redemption data format');
  }

  // Ensure dataBlob is an object before spreading
  if (typeof dataBlob !== 'object' || dataBlob === null || Array.isArray(dataBlob)) {
    throw new Error('Invalid serialized redemption data format');
  }

  const partial = { ...dataBlob } as unknown as Partial<Redemption>; // Clone the data blob from DB

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
          chainName: redemption.chainId, // Note: using chainName in DB but chainId in code for now
          status: redemption.status.toString(),
          data: serializeRedemptionData(redemption as Redemption), // Pass the full object for serialization logic
        },
      });
      logger.info(`Redemption created: ${redemption.id}`);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        logger.warn(`Redemption already exists: ${redemption.id}`);
      } else {
        logErrorContext(`Failed to create redemption ${redemption.id}:`, err);
        throw err;
      }
    }
  }

  static async update(redemption: Redemption): Promise<void> {
    try {
      await prisma.redemption.update({
        where: {
          id: redemption.id,
        },
        data: {
          chainName: redemption.chainId, // Note: using chainName in DB but chainId in code for now
          status: redemption.status.toString(),
          data: serializeRedemptionData(redemption),
        },
      });

      logger.info(`Redemption updated: ${redemption.id}`);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
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
        chainId: record.chainName, // Note: mapping chainName from DB back to chainId in code
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
      return records.map((record) => {
        const deserializedBlobParts = deserializeRedemptionData(record.data);
        return {
          id: record.id,
          chainId: record.chainName, // Note: mapping chainName from DB back to chainId in code
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
      const whereClause: { status: string; chainName?: string } = { status: status.toString() };
      if (chainId) {
        whereClause.chainName = chainId; // Note: using chainName in DB query
      }
      const records = await prisma.redemption.findMany({ where: whereClause });
      return records.map((record) => {
        const deserializedBlobParts = deserializeRedemptionData(record.data);
        return {
          id: record.id,
          chainId: record.chainName, // Note: mapping chainName from DB back to chainId in code
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
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
        logger.warn(`Redemption not found for delete: ${id}`);
      } else {
        logErrorContext(`Failed to delete redemption ${id}:`, err);
        throw err;
      }
    }
  }
}
