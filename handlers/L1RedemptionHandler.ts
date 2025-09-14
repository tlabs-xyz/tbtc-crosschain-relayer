import { ethers, Wallet, providers } from 'ethers';
import { TBTC, DestinationChainName } from '@keep-network/tbtc-v2.ts';
import type { BigNumber } from 'ethers';
import logger, { logErrorContext } from '../utils/Logger.js';
import type { EvmChainConfig } from '../config/schemas/evm.chain.schema.js';

const L1_TX_CONFIRMATION_TIMEOUT_MS = parseInt(
  process.env.L1_TX_CONFIRMATION_TIMEOUT_MS || '300000',
);
const DEFAULT_L1_CONFIRMATIONS = 1; // Default number of confirmations to wait for

export class L1RedemptionHandler {
  private l1Signer: Wallet;
  private sdk: TBTC;
  private l2Signers: Map<string, Wallet> = new Map();

  private constructor(sdk: TBTC, l1Signer: Wallet) {
    this.sdk = sdk;
    this.l1Signer = l1Signer;
  }

  public static async create(
    l1RpcUrl: string,
    relayerL1PrivateKey: string,
    l2ChainConfigs: EvmChainConfig[],
    isTestnet: boolean,
  ): Promise<L1RedemptionHandler> {
    const provider = new providers.JsonRpcProvider(l1RpcUrl);
    const l1Signer = new Wallet(relayerL1PrivateKey, provider);

    // The SDK initialization needs a signer that adapts to ethers v5 or v6.
    // The relayer uses ethers v5 style, so we can cast to `any`.
    let sdk: TBTC;
    if (isTestnet) {
      // On an Ethereum testnet, we connect to the Bitcoin testnet
      sdk = await TBTC.initializeSepolia(l1Signer as any, true);
    } else {
      // On Ethereum mainnet, we connect to the Bitcoin mainnet
      sdk = await TBTC.initializeMainnet(l1Signer as any, false);
    }

    const handler = new L1RedemptionHandler(sdk, l1Signer);

    logger.info(
      `L1RedemptionHandler created for L1 at ${l1RpcUrl}. Relayer L1 address: ${l1Signer.address}`,
    );

    // Initialize cross-chain support for all configured L2s
    for (const config of l2ChainConfigs) {
      if (config.l2Rpc && config.privateKey && config.enableL2Redemption) {
        try {
          const l2Provider = new providers.JsonRpcProvider(config.l2Rpc);
          // Use the same private key for L2 as for L1, assuming it's the same relayer identity
          const l2Signer = new Wallet(relayerL1PrivateKey, l2Provider);
          await sdk.initializeCrossChain(config.chainName as DestinationChainName, l2Signer as any);
          handler.l2Signers.set(config.chainName, l2Signer);
          logger.info(
            `Initialized cross-chain support for ${config.chainName} in L1RedemptionHandler`,
          );
        } catch (error) {
          logErrorContext(
            `Failed to initialize cross-chain support for ${config.chainName} in L1RedemptionHandler`,
            error,
          );
        }
      } else {
        logger.warn(
          `Skipping cross-chain support for ${config.chainName} in L1RedemptionHandler as it is not enabled or missing configuration.`,
        );
      }
    }

    return handler;
  }

  public async relayRedemptionToL1(
    amount: BigNumber,
    signedVaa: Uint8Array,
    l2ChainName: string,
    l2TransactionHash: string,
  ): Promise<string | null> {
    logger.info(
      JSON.stringify({
        message: 'Attempting to relay L2 redemption to L1 using tBTC SDK',
        l2TransactionHash: l2TransactionHash,
        relayerAddress: this.l1Signer.address,
        amount: amount.toString(),
        l2ChainName: l2ChainName,
      }),
    );

    try {
      const redemptionsAny: any = this.sdk.redemptions as any;
      const result = await redemptionsAny.relayRedemptionRequestToL1(
        amount,
        signedVaa,
        l2ChainName as DestinationChainName,
      );

      logger.info(
        JSON.stringify({
          message: 'L1 Redemption relay transaction submitted, awaiting confirmation...',
          l1TransactionHash: result.targetChainTxHash.toString(),
          l2TransactionHash: l2TransactionHash,
        }),
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Timeout waiting for L1 transaction ${result.targetChainTxHash.toString()} confirmation after ${L1_TX_CONFIRMATION_TIMEOUT_MS}ms`,
              ),
            ),
          L1_TX_CONFIRMATION_TIMEOUT_MS,
        ),
      );

      const receipt = (await Promise.race([
        this.l1Signer.provider.waitForTransaction(
          result.targetChainTxHash.toString(),
          DEFAULT_L1_CONFIRMATIONS,
        ),
        timeoutPromise,
      ])) as ethers.providers.TransactionReceipt;

      if (receipt && receipt.status === 1) {
        logger.info(
          JSON.stringify({
            message: 'L1 redemption relay transaction successful!',
            l1TransactionHash: result.targetChainTxHash.toString(),
            l2TransactionHash: l2TransactionHash,
            l1BlockNumber: receipt.blockNumber,
          }),
        );
        return result.targetChainTxHash.toString();
      } else {
        logErrorContext(
          JSON.stringify({
            message: 'L1 redemption relay transaction failed (reverted on-chain).',
            l1TransactionHash: result.targetChainTxHash.toString(),
            l2TransactionHash: l2TransactionHash,
            receiptStatus: receipt?.status,
            receipt,
          }),
          new Error(`L1 tx ${result.targetChainTxHash.toString()} reverted`),
        );
        return null;
      }
    } catch (error: any) {
      const err = error instanceof Error ? error : new Error(String(error));
      logErrorContext(
        JSON.stringify({
          message: 'Error in relayRedemptionToL1.',
          l2TransactionHash,
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack,
          errorDetails: error.error,
          transaction: error.transaction,
          receipt: error.receipt,
        }),
        err,
      );
      // Common issues from example script
      if (err.message.includes('VAA was already executed')) {
        logger.error('This VAA has already been redeemed.');
      } else if (err.message.includes('insufficient funds')) {
        logger.error('Insufficient funds for gas on L1.');
      }
      return null;
    }
  }
}
