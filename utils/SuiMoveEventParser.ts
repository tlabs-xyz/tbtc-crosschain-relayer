import type { SuiEvent } from '@mysten/sui/client';
import {
  parseFundingTransaction,
  parseReveal,
  normalizeInput,
  BitcoinParsingError,
} from './BitcoinTransactionParser.js';
import type { FundingTransaction } from '../types/FundingTransaction.type.js';
import type { Reveal } from '../types/Reveal.type.js';
import logger from './Logger.js';

/**
 * Event data structure for SUI Move DepositInitialized events.
 * Corresponds to the Move struct:
 * ```
 * public struct DepositInitialized has copy, drop {
 *     funding_tx: vector<u8>,
 *     deposit_reveal: vector<u8>,
 *     deposit_owner: vector<u8>,
 *     sender: vector<u8>,
 * }
 * ```
 */
export interface DepositInitializedEventData {
  /** Raw Bitcoin funding transaction data as byte vector */
  funding_tx: string | number[];
  /** Bitcoin deposit reveal data as byte vector */
  deposit_reveal: string | number[];
  /** L2 deposit owner address as byte vector */
  deposit_owner: string | number[];
  /** L2 transaction sender address as byte vector */
  sender: string | number[];
}

/**
 * Parsed data from a SUI DepositInitialized event
 */
export interface ParsedDepositInitializedEvent {
  /** Parsed Bitcoin funding transaction */
  fundingTransaction: FundingTransaction;
  /** Parsed Bitcoin reveal data */
  reveal: Reveal;
  /** L2 deposit owner address (hex string) */
  depositOwner: string;
  /** L2 transaction sender address (hex string) */
  sender: string;
}

/**
 * Parses binary data fields from Sui Move events
 * Handles both hex string and number array formats
 * @param field - Binary field from Move event (string or number[])
 * @returns Normalized byte array
 */
export function parseEventBinaryField(field: string | number[]): number[] {
  if (Array.isArray(field)) {
    // Data is already in number array format
    return normalizeInput(field);
  }

  if (typeof field === 'string') {
    // Data is in hex string format, convert to bytes
    return normalizeInput(field);
  }

  throw new BitcoinParsingError(
    'Invalid binary field format in Move event. Expected string or number array.',
  );
}

/**
 * Converts binary address data to SUI hex address format
 * @param addressBytes - Address as byte array
 * @returns Hex string address with 0x prefix
 */
export function convertBinaryToSuiAddress(addressBytes: number[]): string {
  return '0x' + Buffer.from(addressBytes).toString('hex');
}

/**
 * Parses a SUI DepositInitialized event and returns parsed data
 * @param event - SUI event object
 * @param chainName - Name of the chain processing the event (used for logging)
 * @returns Parsed event data or null if parsing fails
 */
export function parseDepositInitializedEvent(
  event: SuiEvent,
  chainName: string,
): ParsedDepositInitializedEvent | null {
  try {
    // Validate event type
    if (!event.type.includes('DepositInitialized')) {
      return null;
    }

    // Parse event data according to the Move struct
    const eventData = event.parsedJson as DepositInitializedEventData;

    // Validate required fields
    if (
      !eventData.funding_tx ||
      !eventData.deposit_reveal ||
      !eventData.deposit_owner ||
      !eventData.sender
    ) {
      logger.warn('Incomplete SUI deposit event data', {
        chainName,
        txDigest: event.id?.txDigest,
        missingFields: {
          funding_tx: !eventData.funding_tx,
          deposit_reveal: !eventData.deposit_reveal,
          deposit_owner: !eventData.deposit_owner,
          sender: !eventData.sender,
        },
      });
      return null;
    }

    // Parse binary fields from the event data
    const fundingTxBytes = parseEventBinaryField(eventData.funding_tx);
    const revealBytes = parseEventBinaryField(eventData.deposit_reveal);
    const depositOwnerBytes = parseEventBinaryField(eventData.deposit_owner);
    const senderBytes = parseEventBinaryField(eventData.sender);

    if (!fundingTxBytes || !revealBytes || !depositOwnerBytes || !senderBytes) {
      logger.warn('Failed to parse binary fields from SUI event', {
        chainName,
        txDigest: event.id?.txDigest,
        fundingTxValid: !!fundingTxBytes,
        revealValid: !!revealBytes,
        depositOwnerValid: !!depositOwnerBytes,
        senderValid: !!senderBytes,
      });
      return null;
    }

    // Parse Bitcoin transaction and reveal data
    const fundingTransaction = parseFundingTransaction(fundingTxBytes);
    const reveal = parseReveal(revealBytes);

    // Convert SUI addresses to hex format
    const depositOwner = convertBinaryToSuiAddress(depositOwnerBytes);
    const sender = convertBinaryToSuiAddress(senderBytes);

    return {
      fundingTransaction,
      reveal,
      depositOwner,
      sender,
    };
  } catch (error: any) {
    logger.warn(`Failed to parse Bitcoin data from SUI event for ${chainName}:`, {
      error: error.message,
      txDigest: event.id?.txDigest,
      eventType: event.type,
    });
    return null;
  }
}
