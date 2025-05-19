import { Redemption, RedemptionStatus } from '../types/Redemption.type.js';
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

function deserializeRedemption(obj: any): Redemption {
  if (obj.event) {
    if (obj.event.amount && typeof obj.event.amount === 'string') {
      obj.event.amount = ethers.BigNumber.from(obj.event.amount);
    }
    // txOutputValue is kept as string for now, do not reassign
  }
  return obj as Redemption;
}

export class RedemptionStore {
  static async create(redemption: Redemption): Promise<void> {
    try {
      await prisma.redemption.create({
        data: {
          ...serializeRedemption(redemption),
          id: redemption.id,
          status: redemption.status,
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
          ...serializeRedemption(redemption),
          status: redemption.status,
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
      return record ? deserializeRedemption(record.data) : null;
    } catch (err) {
      logger.error(`Failed to read redemption ${id}: ${err}`);
      throw err;
    }
  }

  static async getAll(): Promise<Redemption[]> {
      try {
      const records = await prisma.redemption.findMany();
      return records.map((r: any) => deserializeRedemption(r.data));
      } catch (err) {
      logger.error(`Failed to fetch all redemptions: ${err}`);
      return [];
    }
  }

  static async getByStatus(status: RedemptionStatus): Promise<Redemption[]> {
    try {
      const records = await prisma.redemption.findMany({ where: { status } });
      return records.map((r: any) => deserializeRedemption(r.data));
    } catch (err) {
      logger.error(`Failed to fetch redemptions by status: ${err}`);
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