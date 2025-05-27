import { ethers } from 'ethers';
import {
  wormhole,
  Wormhole,
  UniversalAddress,
  type Network,
  type ChainId,
  chainIdToChain,
  type WormholeMessageId,
  type Chain,
  type VAA,
} from '@wormhole-foundation/sdk';
import evmPlatform from '@wormhole-foundation/sdk/platforms/evm';
import solanaPlatform from '@wormhole-foundation/sdk/platforms/solana';
import logger, { logErrorContext } from '../utils/Logger';
import { stringifyWithBigInt } from '../utils/Numbers';

type SignedVaa = Uint8Array;
type ParsedVaaWithPayload = VAA<'TokenBridge:Transfer'> | VAA<'TokenBridge:TransferWithPayload'>;

const DEFAULT_WORMHOLE_NETWORK: Network = 'Testnet';
const DEFAULT_SDK_PLATFORMS_MODULES = [evmPlatform, solanaPlatform];
const MIN_VAA_CONSISTENCY_LEVEL = 1; // How long does the Guardian network need to wait before signing off on a VAA?
const VAA_FETCH_RETRY_DELAY_MS = parseInt(process.env.VAA_FETCH_RETRY_DELAY_MS || '60000');
const VAA_FETCH_MAX_RETRIES = parseInt(process.env.VAA_FETCH_MAX_RETRIES || '5');
const GET_VAA_TIMEOUT_MS =
  VAA_FETCH_MAX_RETRIES * VAA_FETCH_RETRY_DELAY_MS > 0
    ? VAA_FETCH_MAX_RETRIES * VAA_FETCH_RETRY_DELAY_MS
    : 60000;
const DEFAULT_TARGET_L1_CHAIN_ID: ChainId = 2; // Ethereum Mainnet

export class WormholeVaaService {
  private l2Provider: ethers.providers.JsonRpcProvider;
  private wh!: Wormhole<Network>;

  private constructor(l2RpcOrProvider: string | ethers.providers.JsonRpcProvider) {
    if (typeof l2RpcOrProvider === 'string') {
      this.l2Provider = new ethers.providers.JsonRpcProvider(l2RpcOrProvider);
    } else {
      this.l2Provider = l2RpcOrProvider;
    }
  }

  public static async create(
    l2RpcOrProvider: string | ethers.providers.JsonRpcProvider,
    network: Network = DEFAULT_WORMHOLE_NETWORK,
    platformModules: any[] = DEFAULT_SDK_PLATFORMS_MODULES,
  ): Promise<WormholeVaaService> {
    console.log('[REAL WormholeVaaService.create CALLED] Args:', { l2RpcOrProvider, network, platformModules });
    const service = new WormholeVaaService(l2RpcOrProvider);
    try {
      service.wh = await wormhole(network, platformModules);
      console.log('[REAL WormholeVaaService.create] service.wh initialized:', service.wh ? 'OK' : 'UNDEFINED');
    } catch (e) {
      console.error('[REAL WormholeVaaService.create] Error initializing wormhole SDK:', e);
      throw e; // Re-throw to ensure failure is visible
    }
    const l2Location = typeof l2RpcOrProvider === 'string' ? l2RpcOrProvider : 'provided_instance';
    logger.info(`WormholeVaaService created. L2 Provider: ${l2Location}, Wormhole Network: ${network}`);
    return service;
  }

  /**
   * Fetches and verifies a VAA for a given L2 transaction hash.
   *
   * @param l2TransactionHash - The hash of the L2 transaction to fetch the VAA for.
   * @param emitterChainId - The ID of the L2 chain where the RedemptionRequested event occurred.
   * @param emitterAddress - The address of the emitter on the L2 chain.
   * @returns A tuple containing the VAA bytes and the parsed VAA object.
   */
  public async fetchAndVerifyVaaForL2Event(
    l2TransactionHash: string,
    emitterChainId: ChainId,
    emitterAddress: string,
    targetL1ChainId: ChainId = DEFAULT_TARGET_L1_CHAIN_ID,
  ): Promise<{ vaaBytes: SignedVaa; parsedVaa: ParsedVaaWithPayload } | null> {
    console.log(
      `[REAL WormholeVaaService.fetchAndVerifyVaaForL2Event CALLED] L2 Tx: ${l2TransactionHash}. this.wh is ${this.wh ? 'DEFINED' : 'UNDEFINED'}`,
    );
    if (!this.wh) {
      console.error(
        '[REAL WormholeVaaService.fetchAndVerifyVaaForL2Event] CRITICAL: this.wh is undefined before getChain call.',
      );
      // Potentially throw here or return early to avoid undefined access
      throw new Error('[REAL Service] this.wh is undefined, cannot proceed.');
    }
    const emitterChainName = chainIdToChain(emitterChainId);
    logger.info(
      `Attempting to fetch VAA for L2 transaction: ${l2TransactionHash}, EmitterChain: ${emitterChainName}, EmitterAddr: ${emitterAddress}`,
    );

    try {
      const receipt = await this.l2Provider.getTransactionReceipt(l2TransactionHash);
      if (!receipt) {
        logErrorContext(
          `Failed to get L2 transaction receipt for ${l2TransactionHash}.`,
          new Error('L2 tx receipt fetch failed'),
        );
        return null;
      }
      if (receipt.status === 0) {
        logErrorContext(
          `L2 transaction ${l2TransactionHash} failed (reverted), cannot fetch VAA. Receipt: ${stringifyWithBigInt(receipt)}`,
          new Error('L2 tx reverted'),
        );
        return null;
      }

      logger.info(
        `Successfully fetched L2 transaction receipt for ${l2TransactionHash}. TxHash for parse: ${receipt.transactionHash}`,
      );

      const chainContext = this.wh.getChain(emitterChainName);
      const wormholeMessageIds: WormholeMessageId[] = await chainContext.parseTransaction(
        receipt.transactionHash,
      );

      if (!wormholeMessageIds || wormholeMessageIds.length === 0) {
        logErrorContext(
          `No Wormhole messages found in L2 transaction ${l2TransactionHash}. Chain: ${emitterChainName}.`,
          new Error('parseTransaction returned no messages'),
        );
        return null;
      }

      const emitterUA = new UniversalAddress(emitterAddress);
      const messageId = wormholeMessageIds.find(
        (whm) => whm.emitter.equals(emitterUA) && whm.chain === emitterChainName,
      );

      if (!messageId) {
        logErrorContext(
          `Could not find Wormhole message from emitter ${emitterAddress} on chain ${emitterChainName} in L2 transaction ${l2TransactionHash}. Found messages: ${stringifyWithBigInt(wormholeMessageIds)}`,
          new Error('Relevant WormholeMessageId not found'),
        );
        return null;
      }

      logger.info(
        `Successfully parsed Wormhole message ID: Chain: ${messageId.chain}, Emitter: ${messageId.emitter.toString()}, Sequence: ${messageId.sequence}.`,
      );

      const discriminatorsToTry: Array<'TokenBridge:TransferWithPayload' | 'TokenBridge:Transfer'> =
        ['TokenBridge:TransferWithPayload', 'TokenBridge:Transfer'];

      let fetchedParsedVaa: ParsedVaaWithPayload | null = null;
      let lastGetVaaError: any = null;

      for (const disc of discriminatorsToTry) {
        try {
          logger.info(`Attempting to fetch VAA with discriminator: ${disc}`);
          const vaa = await this.wh.getVaa(messageId, disc, GET_VAA_TIMEOUT_MS);
          if (vaa) {
            fetchedParsedVaa = vaa as ParsedVaaWithPayload;
            logger.info(`Successfully fetched VAA with discriminator: ${disc}`);
            break; // Found a VAA
          }
        } catch (e: any) {
          lastGetVaaError = e;
          logErrorContext(
            `Error fetching VAA using this.wh.getVaa with discriminator: ${disc}: ${e.message}`,
            e,
          );
          // Continue to try the next discriminator
        }
      }

      if (!fetchedParsedVaa) {
        logErrorContext(
          `this.wh.getVaa did not return a VAA for message ID ${stringifyWithBigInt(messageId)} after trying all discriminators. Last error: ${lastGetVaaError?.message}`,
          new Error('this.wh.getVaa failed or returned null VAA after all retries'),
        );
        return null;
      }

      if (!this.verifyParsedVaa(fetchedParsedVaa, emitterChainId, emitterAddress)) {
        logErrorContext(
          `Initial VAA verification (emitter check) failed for ${l2TransactionHash}.`,
          new Error('Initial VAA verification failed'),
        );
        return null;
      }

      const targetL1ChainName = chainIdToChain(targetL1ChainId);
      const l1ChainContext = this.wh.getChain(targetL1ChainName);

      try {
        const tokenBridge = await l1ChainContext.getTokenBridge();
        if (
          fetchedParsedVaa.payloadName === 'Transfer' ||
          fetchedParsedVaa.payloadName === 'TransferWithPayload'
        ) {
          const isCompleted = await tokenBridge.isTransferCompleted(fetchedParsedVaa);
          if (!isCompleted) {
            logErrorContext(
              `Token bridge transfer VAA not completed on L1 (${targetL1ChainName}) for ${l2TransactionHash}. VAA Seq: ${fetchedParsedVaa.sequence}, Type: ${fetchedParsedVaa.payloadName}`,
              new Error('VAA transfer not completed on L1'),
            );
            return null;
          }
          logger.info(
            `Token bridge transfer VAA confirmed completed on L1 (${targetL1ChainName}) for ${l2TransactionHash}. Type: ${fetchedParsedVaa.payloadName}`,
          );
        }
      } catch (e: any) {
        logErrorContext(
          `Error checking VAA completion on L1 (${targetL1ChainName}): ${e.message}`,
          e,
        );
        return null;
      }

      let signedVaaBytes: SignedVaa | null = null;
      if ('bytes' in fetchedParsedVaa && (fetchedParsedVaa as any).bytes instanceof Uint8Array) {
        signedVaaBytes = (fetchedParsedVaa as any).bytes;
      } else if (typeof (fetchedParsedVaa as any).serialize === 'function') {
        signedVaaBytes = (fetchedParsedVaa as any).serialize();
      }

      if (!signedVaaBytes || signedVaaBytes.length === 0) {
        logErrorContext(
          `Could not extract VAA bytes from fetched VAA object (tried .bytes and .serialize()). VAA: ${stringifyWithBigInt(fetchedParsedVaa)}`,
          new Error('VAA bytes extraction failed'),
        );
        return null;
      }
      logger.info(
        `Successfully obtained VAA object and its bytes. VAA Length: ${signedVaaBytes.length}`,
      );

      logger.info(`VAA fetched and verified (including L1 completion) for ${l2TransactionHash}.`);
      return { vaaBytes: signedVaaBytes, parsedVaa: fetchedParsedVaa };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logErrorContext(
        `Error fetching and verifying VAA for L2 event ${l2TransactionHash}. EmitterChain: ${emitterChainName}, EmitterAddr: ${emitterAddress}. Error: ${err.message}`,
        err,
      );
      return null;
    }
  }

  private verifyParsedVaa(
    parsedVaa: VAA<any>,
    expectedEmitterChainId: ChainId,
    expectedEmitterAddress: string,
  ): boolean {
    const expectedEmitterChainName = chainIdToChain(expectedEmitterChainId);
    const actualEmitterChainName = parsedVaa.emitterChain as Chain;

    logger.info(
      `Attempting to verify parsed VAA. Expected Emitter: ${expectedEmitterChainName} / ${expectedEmitterAddress}. Actual Emitter: ${actualEmitterChainName} / ${parsedVaa.emitterAddress.toString()}. Protocol: ${parsedVaa.protocolName}, Payload: ${parsedVaa.payloadName}`,
    );

    if (actualEmitterChainName !== expectedEmitterChainName) {
      logErrorContext(
        `VAA verification failed: Emitter chain mismatch. Expected: ${expectedEmitterChainName} (Id: ${expectedEmitterChainId}), Got: ${actualEmitterChainName} (SDK value: ${parsedVaa.emitterChain})`,
        new Error('VAA emitter chain mismatch'),
      );
      return false;
    }

    const expectedEmitterUA = new UniversalAddress(expectedEmitterAddress);
    if (!parsedVaa.emitterAddress.equals(expectedEmitterUA)) {
      logErrorContext(
        `VAA verification failed: Emitter address mismatch. Expected: ${expectedEmitterAddress} (Native: ${expectedEmitterUA.toNative(expectedEmitterChainName).toString()}), Got: ${parsedVaa.emitterAddress.toString()} (Native: ${parsedVaa.emitterAddress.toNative(actualEmitterChainName).toString()})`,
        new Error('VAA emitter address mismatch'),
      );
      return false;
    }

    if (parsedVaa.protocolName !== 'TokenBridge') {
      logErrorContext(
        `VAA verification failed: Protocol name mismatch. Expected: 'TokenBridge', Got: '${parsedVaa.protocolName}'`,
        new Error('VAA protocol name mismatch'),
      );
      return false;
    }

    if (parsedVaa.payloadName !== 'Transfer' && parsedVaa.payloadName !== 'TransferWithPayload') {
      logErrorContext(
        `VAA verification failed: Payload name mismatch. Expected: 'Transfer' or 'TransferWithPayload', Got: '${parsedVaa.payloadName}'`,
        new Error('VAA payload name mismatch'),
      );
      return false;
    }

    if (parsedVaa.consistencyLevel === MIN_VAA_CONSISTENCY_LEVEL) {
      logger.warn(
        `VAA verification warning: Low consistency level. Expected ${MIN_VAA_CONSISTENCY_LEVEL}, Got: ${parsedVaa.consistencyLevel}. VAA details: emitter ${parsedVaa.emitterAddress.toString()}, seq ${parsedVaa.sequence}, chain ${actualEmitterChainName}.`,
      );
    }

    logger.info(
      `VAA verification passed for emitter: ${parsedVaa.emitterAddress.toString()}, chain: ${actualEmitterChainName}, sequence: ${parsedVaa.sequence}.`,
    );
    return true;
  }
}
