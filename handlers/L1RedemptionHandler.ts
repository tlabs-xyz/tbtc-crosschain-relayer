import { ethers } from 'ethers';
import logger, { logErrorContext } from '../utils/Logger.js';
import { L1BitcoinRedeemerABI } from '../interfaces/L1BitcoinRedeemer.js';
import type { RedemptionRequestedEventData } from '../types/Redemption.type.js';
import { TIMEOUTS, GAS_CONFIG, BLOCKCHAIN_CONFIG } from '../utils/Constants.js';

export class L1RedemptionHandler {
  private l1Provider: ethers.providers.JsonRpcProvider;
  private l1Signer: ethers.Wallet;
  private l1BitcoinRedeemer: ethers.Contract;

  constructor(l1RpcUrl: string, l1BitcoinRedeemerAddress: string, relayerL1PrivateKey: string) {
    this.l1Provider = new ethers.providers.JsonRpcProvider(l1RpcUrl);
    this.l1Signer = new ethers.Wallet(relayerL1PrivateKey, this.l1Provider);
    this.l1BitcoinRedeemer = new ethers.Contract(
      l1BitcoinRedeemerAddress,
      L1BitcoinRedeemerABI,
      this.l1Signer,
    );
    logger.info(
      `L1RedemptionHandler initialized for L1BitcoinRedeemer at ${l1BitcoinRedeemerAddress} on ${l1RpcUrl}. Relayer L1 address: ${this.l1Signer.address}`,
    );
  }

  /**
   * Submit redemption data to L1 contract
   * @param redemptionData - The redemption data from the L2 event
   * @param signedVaa - The signed VAA bytes
   * @returns Promise<string | null> - The L1 transaction hash if successful, null otherwise
   */
  public async submitRedemptionDataToL1(
    redemptionData: RedemptionRequestedEventData,
    signedVaa: Uint8Array,
  ): Promise<string | null> {
    logger.info(
      JSON.stringify({
        message: 'Submitting redemption data to L1 contract finalizeL2Redemption for processing...',
        l2TransactionHash: redemptionData.l2TransactionHash,
        walletPubKeyHash: redemptionData.walletPubKeyHash,
        amount: redemptionData.amount.toString(),
        l1BitcoinRedeemerAddress: this.l1BitcoinRedeemer.address,
      }),
    );

    try {
      // Convert walletPubKeyHash (bytes20 hex string) to bytes32 hex string for L1 contract
      let walletPubKeyHashBytes32 = redemptionData.walletPubKeyHash;
      if (walletPubKeyHashBytes32.startsWith('0x')) {
        walletPubKeyHashBytes32 = walletPubKeyHashBytes32.substring(2);
      }
      // Pad to 32 bytes (64 hex characters)
      walletPubKeyHashBytes32 = '0x' + walletPubKeyHashBytes32.padEnd(64, '0');

      const encodedVm = `0x${Buffer.from(signedVaa).toString('hex')}`;

      const args = [
        walletPubKeyHashBytes32,
        redemptionData.mainUtxo,
        redemptionData.amount,
        encodedVm,
      ];

      logger.info(
        `Estimating gas for finalizeL2Redemption with args: ${JSON.stringify(args.map((arg) => (ethers.BigNumber.isBigNumber(arg) ? arg.toString() : arg)))}`,
      );
      const estimatedGas = await this.l1BitcoinRedeemer.estimateGas.finalizeL2Redemption(...args);
      const gasLimit = ethers.BigNumber.from(estimatedGas)
        .mul(ethers.BigNumber.from(Math.round(GAS_CONFIG.GAS_ESTIMATE_MULTIPLIER * 100)))
        .div(100);
      logger.info(
        `Estimated gas: ${estimatedGas.toString()}, Gas limit with multiplier (${GAS_CONFIG.GAS_ESTIMATE_MULTIPLIER}x): ${gasLimit.toString()}`,
      );

      const tx = await this.l1BitcoinRedeemer.finalizeL2Redemption(...args, {
        gasLimit: gasLimit,
        // gasPrice: await this.l1Provider.getGasPrice(), // Optional: for non-EIP1559 chains or specific control
      });

      logger.info(
        JSON.stringify({
          message: 'L1 finalizeL2Redemption transaction submitted, awaiting confirmation...',
          l1TransactionHash: tx.hash,
          l2TransactionHash: redemptionData.l2TransactionHash,
        }),
      );

      // Wait for transaction confirmation with timeout
      // tx.wait() can take (confirmations?: number, timeout?: number)
      // However, ethers v5 tx.wait() timeout parameter is not for the wait itself but for the provider response per block.
      // For a true overall timeout, we need to race Promise.race([tx.wait(), timeoutPromise])
      logger.info(
        `Awaiting L1 transaction confirmation for ${tx.hash}. Confirmations: ${BLOCKCHAIN_CONFIG.DEFAULT_L1_CONFIRMATIONS}, Timeout: ${TIMEOUTS.L1_TX_CONFIRMATION_TIMEOUT_MS}ms`,
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Timeout waiting for L1 transaction ${tx.hash} confirmation after ${TIMEOUTS.L1_TX_CONFIRMATION_TIMEOUT_MS}ms`,
              ),
            ),
          TIMEOUTS.L1_TX_CONFIRMATION_TIMEOUT_MS,
        ),
      );

      const receipt = (await Promise.race([
        tx.wait(BLOCKCHAIN_CONFIG.DEFAULT_L1_CONFIRMATIONS),
        timeoutPromise,
      ])) as ethers.providers.TransactionReceipt;

      if (receipt.status === 1) {
        logger.info(
          JSON.stringify({
            message: 'L1 finalizeL2Redemption transaction successful!',
            l1TransactionHash: tx.hash,
            l2TransactionHash: redemptionData.l2TransactionHash,
            l1BlockNumber: receipt.blockNumber,
          }),
        );
        return tx.hash;
      } else {
        logErrorContext(
          JSON.stringify({
            message: 'L1 finalizeL2Redemption transaction failed (reverted on-chain).',
            l1TransactionHash: tx.hash,
            l2TransactionHash: redemptionData.l2TransactionHash,
            receiptStatus: receipt.status,
            receipt,
          }),
          new Error(`L1 tx ${tx.hash} reverted`),
        );
        return null;
      }
    } catch (error: any) {
      const err = error instanceof Error ? error : new Error(String(error));
      logErrorContext(
        JSON.stringify({
          message: 'Error in finalizeL2Redemption on L1.',
          l2TransactionHash: redemptionData.l2TransactionHash,
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack,
          errorDetails: error.error,
          transaction: error.transaction,
          receipt: error.receipt,
        }),
        err,
      );
      return null;
    }
  }
}
