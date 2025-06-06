// services/WormholeVaaService.ts - Wormhole VAA Service for tBTC cross-chain relayer
//
// This service fetches, verifies, and parses Wormhole VAAs for L2 to L1 cross-chain operations.
// It provides utilities for VAA retrieval, protocol/payload validation, and L1 completion checks.

import * as ethers from 'ethers';
import {
  wormhole,
  type Wormhole,
  type Network,
  type ChainId,
  chainIdToChain,
  type WormholeMessageId,
  type VAA,
  type Chain,
} from '@wormhole-foundation/sdk';
import { toNative } from '@wormhole-foundation/sdk-connect';
import evmPlatform from '@wormhole-foundation/sdk/platforms/evm';
import solanaPlatform from '@wormhole-foundation/sdk/platforms/solana';
import logger, { logErrorContext } from '../utils/Logger.js';
import { stringifyWithBigInt } from '../utils/Numbers.js';
import {
  TIMEOUTS,
  BLOCKCHAIN_CONFIG,
  PROTOCOL_CONFIG,
  type SupportedPayloadName,
} from '../utils/Constants.js';
import { toSerializableError } from '../types/Error.types.js';

type ParsedVaaWithPayload = VAA<'TokenBridge:Transfer'> | VAA<'TokenBridge:TransferWithPayload'>;

// Configuration constants
const DEFAULT_WORMHOLE_NETWORK: Network = 'Testnet';
const DEFAULT_SDK_PLATFORMS_MODULES = [
  () => Promise.resolve(evmPlatform),
  () => Promise.resolve(solanaPlatform),
];

interface VaaFetchResult {
  vaaBytes: Uint8Array;
  parsedVaa: ParsedVaaWithPayload;
}

interface VaaData {
  protocolName: string;
  payloadName: string;
  payloadLiteral?: string;
  sequence: string;
  bytes?: Uint8Array;
  serialize(): Uint8Array;
}

export class WormholeVaaService {
  private readonly l2Provider: ethers.providers.JsonRpcProvider;
  private wh!: Wormhole<Network>;

  // =====================
  // Initialization & Construction
  // =====================

  /**
   * Private constructor. Use WormholeVaaService.create() to instantiate.
   * @param l2Rpc The L2 RPC endpoint
   */
  private constructor(l2Rpc: string) {
    this.l2Provider = new ethers.providers.JsonRpcProvider(l2Rpc);
  }

  /**
   * Factory method to create and initialize a WormholeVaaService instance.
   * @param l2Rpc The L2 RPC endpoint
   * @param network The Wormhole network (default: Testnet)
   * @param platformModules Platform modules for Wormhole SDK
   * @returns A fully initialized WormholeVaaService
   */
  public static async create(
    l2Rpc: string,
    network: Network = DEFAULT_WORMHOLE_NETWORK,
    platformModules = DEFAULT_SDK_PLATFORMS_MODULES,
  ): Promise<WormholeVaaService> {
    const service = new WormholeVaaService(l2Rpc);
    service.wh = await wormhole(network, platformModules);

    if (!service.wh) {
      throw new Error(
        '[WormholeVaaService.create] wormhole SDK initialization failed: wormhole() returned null or undefined.',
      );
    }

    logger.info(`WormholeVaaService created. L2 Provider: ${l2Rpc}, Wormhole Network: ${network}`);
    return service;
  }

  // =====================
  // VAA Fetching & Verification
  // =====================

  /**
   * Fetches and verifies a VAA for a given L2 transaction hash.
   * @param l2TransactionHash The hash of the L2 transaction
   * @param emitterChainId The ID of the L2 chain where the event occurred
   * @param emitterAddress The address of the emitter on the L2 chain
   * @param targetL1ChainId The ID of the target L1 chain for completion verification
   * @returns A tuple containing the VAA bytes and the parsed VAA object, or null if failed
   */
  public async fetchAndVerifyVaaForL2Event(
    l2TransactionHash: string,
    emitterChainId: ChainId,
    emitterAddress: string,
    targetL1ChainId: ChainId,
  ): Promise<VaaFetchResult | null> {
    const emitterChainName = chainIdToChain(emitterChainId);
    const targetL1ChainName = chainIdToChain(targetL1ChainId);

    // Get and validate L2 transaction receipt
    const receipt = await this.getValidatedTransactionReceipt(l2TransactionHash, emitterChainName);
    if (!receipt) {
      return null;
    }

    // Parse Wormhole messages from transaction
    const matchingMessage = await this.findMatchingWormholeMessage(
      receipt,
      emitterChainName,
      emitterAddress,
      l2TransactionHash,
    );
    if (!matchingMessage) {
      return null;
    }

    // Fetch VAA with multiple discriminator attempts
    const fetchedParsedVaa = await this.fetchVaaWithRetries(
      matchingMessage,
      l2TransactionHash,
      emitterAddress,
    );
    if (!fetchedParsedVaa) {
      return null;
    }

    // Verify the VAA
    const isVerified = this.verifyParsedVaa(fetchedParsedVaa, emitterChainId, emitterAddress);
    if (!isVerified) {
      return null;
    }

    // Validate protocol and payload
    if (!this.validateVaaProtocolAndPayload(fetchedParsedVaa)) {
      return null;
    }

    // Check L1 completion if required
    if (
      targetL1ChainId &&
      !(await this.checkL1Completion(fetchedParsedVaa, targetL1ChainName, l2TransactionHash))
    ) {
      return null;
    }

    // Extract VAA bytes
    const signedVaaBytes = this.extractVaaBytes(fetchedParsedVaa);

    return {
      vaaBytes: signedVaaBytes,
      parsedVaa: fetchedParsedVaa,
    };
  }

  // =====================
  // Internal Utilities
  // =====================

  /**
   * Get and validate the transaction receipt for a given L2 transaction hash.
   * @param l2TransactionHash The L2 transaction hash
   * @param emitterChainName The name of the emitter chain
   * @returns The transaction receipt or null if not found/invalid
   */
  private async getValidatedTransactionReceipt(
    l2TransactionHash: string,
    emitterChainName: string,
  ): Promise<ethers.providers.TransactionReceipt | null> {
    let receipt: ethers.providers.TransactionReceipt | null;

    try {
      receipt = await this.l2Provider.getTransactionReceipt(l2TransactionHash);
    } catch (error: unknown) {
      logErrorContext(
        `Failed to get L2 transaction receipt for ${l2TransactionHash}. Original error: ${toSerializableError(error).message}`,
        error,
      );
      return null;
    }

    if (!receipt) {
      logErrorContext(
        `Failed to get L2 transaction receipt for ${l2TransactionHash} on ${emitterChainName}. Receipt is null.`,
        new Error('L2 transaction receipt is null'),
      );
      return null;
    }

    if (receipt.status === 0) {
      logErrorContext(
        `L2 transaction ${l2TransactionHash} failed (reverted), cannot fetch VAA. Receipt: ${stringifyWithBigInt(receipt)}`,
        new Error('L2 transaction failed'),
      );
      return null;
    }

    return receipt;
  }

  /**
   * Find the matching Wormhole message in a transaction receipt.
   * @param receipt The transaction receipt
   * @param emitterChainName The name of the emitter chain
   * @param emitterAddress The emitter address
   * @param l2TransactionHash The L2 transaction hash
   * @returns The matching WormholeMessageId or null
   */
  private async findMatchingWormholeMessage(
    receipt: ethers.providers.TransactionReceipt,
    emitterChainName: string,
    emitterAddress: string,
    l2TransactionHash: string,
  ): Promise<WormholeMessageId | null> {
    const chain = this.wh.getChain(emitterChainName as Chain);
    const wormholeMessageIds = await chain.parseTransaction(receipt.transactionHash);

    if (!wormholeMessageIds || wormholeMessageIds.length === 0) {
      logErrorContext(
        `No Wormhole messages found in L2 transaction ${l2TransactionHash}. Chain: ${emitterChainName}.`,
        new Error('No Wormhole messages found in L2 transaction'),
      );
      return null;
    }

    const expectedEmitterUniversalAddress = toNative(
      emitterChainName as Chain,
      emitterAddress,
    ).toUniversalAddress();

    const matchingMessage = wormholeMessageIds.find(
      (messageId) =>
        messageId.chain === emitterChainName &&
        messageId.emitter.toUniversalAddress().toString() ===
          expectedEmitterUniversalAddress.toString(),
    );

    if (!matchingMessage) {
      logErrorContext(
        `Could not find relevant Wormhole message from emitter ${expectedEmitterUniversalAddress.toString()} (derived from native ${emitterAddress}) on chain ${emitterChainName} in L2 transaction ${l2TransactionHash}. All found messages: ${stringifyWithBigInt(wormholeMessageIds)}`,
        new Error('Relevant Wormhole message not found'),
      );
      return null;
    }

    return matchingMessage;
  }

  /**
   * Fetch the VAA with retries for all supported discriminators.
   * @param matchingMessage The Wormhole message ID
   * @param l2TransactionHash The L2 transaction hash
   * @param emitterAddress The emitter address
   * @returns The parsed VAA or null
   */
  private async fetchVaaWithRetries(
    matchingMessage: WormholeMessageId,
    l2TransactionHash: string,
    emitterAddress: string,
  ): Promise<ParsedVaaWithPayload | null> {
    let fetchedParsedVaa: ParsedVaaWithPayload | null = null;
    let lastError: Error | undefined;

    for (const discriminator of PROTOCOL_CONFIG.SUPPORTED_DISCRIMINATORS) {
      try {
        const vaaResult = await this.wh.getVaa(
          matchingMessage,
          discriminator,
          TIMEOUTS.VAA_FETCH_TIMEOUT_MS,
        );
        if (vaaResult) {
          fetchedParsedVaa = vaaResult as ParsedVaaWithPayload;
          break; // Successfully got VAA, exit loop
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(toSerializableError(error).message);
        // Continue trying next discriminator
      }
    }

    if (lastError && !fetchedParsedVaa) {
      logErrorContext(
        `Error fetching VAA for L2 transaction ${l2TransactionHash}, emitter ${emitterAddress}, sequence ${matchingMessage.sequence}: ${lastError.message}`,
        lastError,
      );
      return null;
    }

    if (!fetchedParsedVaa) {
      logErrorContext(
        `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(matchingMessage)} after trying all discriminators`,
        new Error('Failed to get VAA bytes (returned null)'),
      );
      return null;
    }

    return fetchedParsedVaa;
  }

  /**
   * Validate the protocol and payload of a parsed VAA.
   * @param fetchedParsedVaa The parsed VAA
   * @returns True if valid, false otherwise
   */
  private validateVaaProtocolAndPayload(fetchedParsedVaa: ParsedVaaWithPayload): boolean {
    const vaaData = fetchedParsedVaa as unknown as VaaData;

    // Validate protocol name
    const protocolName = vaaData.protocolName;
    if (protocolName !== PROTOCOL_CONFIG.EXPECTED_PROTOCOL_NAME) {
      logErrorContext(
        `[WormholeVaaService] VAA verification failed: Protocol name mismatch. Expected: ${PROTOCOL_CONFIG.EXPECTED_PROTOCOL_NAME}, Got: ${protocolName}.`,
        new Error('VAA protocol name mismatch'),
      );
      return false;
    }

    // Validate payload name
    const payloadName = vaaData.payloadLiteral || vaaData.payloadName;
    if (!this.isSupportedPayloadName(payloadName)) {
      logErrorContext(
        `[WormholeVaaService] Payload name mismatch. Expected: ${PROTOCOL_CONFIG.SUPPORTED_PAYLOAD_NAMES.join(' or ')}, Got: ${payloadName}.`,
        new Error('VAA payload name mismatch'),
      );
      return false;
    }

    return true;
  }

  /**
   * Check if the VAA transfer is completed on L1.
   * @param fetchedParsedVaa The parsed VAA
   * @param targetL1ChainName The target L1 chain name
   * @param l2TransactionHash The L2 transaction hash
   * @returns True if completed, false otherwise
   */
  private async checkL1Completion(
    fetchedParsedVaa: ParsedVaaWithPayload,
    targetL1ChainName: string,
    l2TransactionHash: string,
  ): Promise<boolean> {
    const vaaData = fetchedParsedVaa as unknown as VaaData;

    // Use the same payload name resolution logic as validateVaaProtocolAndPayload
    const payloadName = vaaData.payloadLiteral || vaaData.payloadName;
    if (!this.isSupportedPayloadName(payloadName)) {
      return true; // Skip check for unsupported payload types
    }

    try {
      const l1Chain = this.wh.getChain(targetL1ChainName as Chain);
      const tokenBridge = await l1Chain.getTokenBridge();
      const isCompleted = await tokenBridge.isTransferCompleted(
        fetchedParsedVaa as VAA<'TokenBridge:Transfer'>,
      );

      if (!isCompleted) {
        logErrorContext(
          `Token bridge transfer VAA not completed on L1 (${targetL1ChainName}) for ${l2TransactionHash}. VAA Seq: ${vaaData.sequence}, Type: ${payloadName}`,
          new Error('VAA transfer not completed on L1'),
        );
        return false;
      } else {
        logger.debug(
          `Token bridge transfer VAA confirmed completed on L1 (${targetL1ChainName}) for ${l2TransactionHash}. VAA Seq: ${vaaData.sequence}`,
        );
        return true;
      }
    } catch (e: unknown) {
      logErrorContext(
        `Error checking VAA completion on L1 (${targetL1ChainName}): ${toSerializableError(e).message}`,
        e,
      );
      return false;
    }
  }

  /**
   * Extract the VAA bytes from a parsed VAA.
   * @param fetchedParsedVaa The parsed VAA
   * @returns The VAA bytes as a Uint8Array
   */
  private extractVaaBytes(fetchedParsedVaa: ParsedVaaWithPayload): Uint8Array {
    const vaaData = fetchedParsedVaa as unknown as VaaData;

    if (vaaData.bytes && vaaData.bytes instanceof Uint8Array) {
      return vaaData.bytes;
    } else {
      return vaaData.serialize();
    }
  }

  /**
   * Verify the parsed VAA's emitter chain and address.
   * @param vaa The parsed VAA
   * @param expectedEmitterChainId The expected emitter chain ID
   * @param expectedNativeEmitterAddress The expected native emitter address
   * @returns True if verified, false otherwise
   */
  private verifyParsedVaa(
    vaa: ParsedVaaWithPayload,
    expectedEmitterChainId: ChainId,
    expectedNativeEmitterAddress: string,
  ): boolean {
    const expectedEmitterChainName = chainIdToChain(expectedEmitterChainId);
    const expectedEmitterUA = toNative(
      expectedEmitterChainName as Chain,
      expectedNativeEmitterAddress,
    ).toUniversalAddress();

    const chainMatches = vaa.emitterChain === expectedEmitterChainName;
    const addressMatches = vaa.emitterAddress.equals(expectedEmitterUA);

    if (!chainMatches) {
      logErrorContext(
        `VAA verification failed: Emitter chain mismatch. Expected: ${expectedEmitterChainName} (ID: ${expectedEmitterChainId}), Got: ${vaa.emitterChain}`,
        new Error('VAA emitter chain mismatch'),
      );
      return false;
    }

    if (!addressMatches) {
      logErrorContext(
        `VAA verification failed: Emitter address mismatch. Expected: ${expectedEmitterUA.toString()} (derived from native ${expectedNativeEmitterAddress}), Got: ${vaa.emitterAddress.toString()}`,
        new Error('VAA emitter address mismatch'),
      );
      return false;
    }

    // Check consistency level
    if (
      vaa.consistencyLevel < BLOCKCHAIN_CONFIG.MIN_VAA_CONSISTENCY_LEVEL &&
      vaa.consistencyLevel !== 0
    ) {
      logger.warn(
        `VAA verification warning: Low consistency level. Expected ${BLOCKCHAIN_CONFIG.MIN_VAA_CONSISTENCY_LEVEL}, Got: ${vaa.consistencyLevel}`,
      );
      // Continue with verification even with low consistency level (just warn)
    }

    return true;
  }

  /**
   * Type guard to check if a string is a supported payload name.
   * @param payloadName The payload name string
   * @returns True if supported, false otherwise
   */
  private isSupportedPayloadName(payloadName: string): payloadName is SupportedPayloadName {
    return PROTOCOL_CONFIG.SUPPORTED_PAYLOAD_NAMES.includes(payloadName as SupportedPayloadName);
  }
}
