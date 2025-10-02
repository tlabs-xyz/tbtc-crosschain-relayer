import { ethers } from 'ethers';
import logger from '../utils/Logger.js';

/**
 * Service for interacting with Wormhole Executor API and generating executor parameters
 * for L1BTCDepositorNttWithExecutor contract
 */
export class ExecutorService {
  private readonly executorApiUrl: string;
  private readonly timeout: number;

  constructor(executorApiUrl: string = 'https://executor.labsapis.com/v0/quote', timeout: number = 30000) {
    this.executorApiUrl = executorApiUrl;
    this.timeout = timeout;
  }

  /**
   * Generate executor parameters for a cross-chain transfer
   * @param srcChain Source chain ID (Ethereum = 2)
   * @param dstChain Destination chain ID (SeiEVM = 40, BaseSepolia = 10004)
   * @param refundAddress User's address to receive refunds
   * @param relayInstructions Gas limit and execution parameters for destination chain
   * @returns Executor parameters including signed quote and cost
   */
  async generateExecutorParameters(
    srcChain: number,
    dstChain: number,
    refundAddress: string,
    relayInstructions: string = '0x01'
  ): Promise<{
    executorArgs: {
      value: string;
      refundAddress: string;
      signedQuote: string;
      instructions: string;
    };
    estimatedCost: string;
  }> {
    try {
      logger.info(`Generating executor parameters for ${srcChain} -> ${dstChain}`);

      // Validate refund address first
      if (!ethers.utils.isAddress(refundAddress)) {
        throw new Error('Invalid refund address provided');
      }

      const requestBody = {
        srcChain,
        dstChain,
        relayInstructions,
      };

      logger.debug('Executor API request:', requestBody);

      const response = await fetch(this.executorApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Executor API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug('Executor API response:', data);

      if (!data.signedQuote || !data.estimatedCost) {
        throw new Error('Invalid executor API response: missing signedQuote or estimatedCost');
      }

      const executorArgs = {
        value: data.estimatedCost,
        refundAddress,
        signedQuote: data.signedQuote,
        instructions: relayInstructions,
      };

      logger.info(`Generated executor parameters: cost=${data.estimatedCost} wei, quote length=${data.signedQuote.length}`);

      return {
        executorArgs,
        estimatedCost: data.estimatedCost,
      };
    } catch (error: any) {
      logger.error(`Failed to generate executor parameters: ${error.message}`);
      throw new Error(`Executor parameter generation failed: ${error.message}`);
    }
  }

  /**
   * Generate fee arguments for the executor
   * @param dbps Fee in basis points (100 = 0.1%, 10000 = 10%)
   * @param payee Address to receive the fee
   * @returns Fee arguments structure
   */
  generateFeeArgs(dbps: number = 0, payee: string = ethers.constants.AddressZero): {
    dbps: number;
    payee: string;
  } {
    if (dbps > 10000) {
      throw new Error('Fee cannot exceed 100% (10000 bps)');
    }

    return {
      dbps,
      payee,
    };
  }

  /**
   * Generate relay instructions for destination chain execution
   * @param gasLimit Gas limit for destination chain execution
   * @returns Encoded relay instructions
   */
  generateRelayInstructions(gasLimit: number = 500000): string {
    if (gasLimit <= 0) {
      throw new Error('Gas limit must be greater than zero');
    }
    // Simple encoding: gas limit as 32-byte hex
    return ethers.utils.hexZeroPad(ethers.utils.hexlify(gasLimit), 32);
  }

  /**
   * Validate executor parameters before use
   * @param executorArgs Executor arguments to validate
   * @param feeArgs Fee arguments to validate
   * @returns True if valid, throws error if invalid
   */
  validateExecutorParameters(
    executorArgs: {
      value: string;
      refundAddress: string;
      signedQuote: string;
      instructions: string;
    },
    feeArgs: {
      dbps: number;
      payee: string;
    }
  ): boolean {
    // Validate executor args
    if (!executorArgs.signedQuote || executorArgs.signedQuote.length < 10) {
      throw new Error('Invalid signed quote: too short or empty');
    }

    if (!executorArgs.signedQuote.match(/^0x[0-9a-fA-F]+$/)) {
      throw new Error('Invalid signed quote: not a valid hex string');
    }

    if (!ethers.utils.isAddress(executorArgs.refundAddress)) {
      throw new Error('Invalid refund address');
    }

    if (!ethers.BigNumber.isBigNumber(ethers.BigNumber.from(executorArgs.value))) {
      throw new Error('Invalid executor value: not a valid number');
    }

    // Validate fee args
    if (feeArgs.dbps > 10000) {
      throw new Error('Fee cannot exceed 100% (10000 bps)');
    }

    if (feeArgs.dbps > 0 && !ethers.utils.isAddress(feeArgs.payee)) {
      throw new Error('Invalid fee payee address');
    }

    if (feeArgs.dbps === 0 && feeArgs.payee !== ethers.constants.AddressZero) {
      logger.warn('Fee is 0 but payee is not zero address - this is allowed but unusual');
    }

    return true;
  }

  /**
   * Calculate total cost for a transfer including NTT delivery price and executor cost
   * @param nttDeliveryPrice NTT delivery price from underlying manager
   * @param executorCost Executor cost from signed quote
   * @returns Total cost in wei
   */
  calculateTotalCost(nttDeliveryPrice: string, executorCost: string): string {
    const nttPrice = ethers.BigNumber.from(nttDeliveryPrice);
    const execCost = ethers.BigNumber.from(executorCost);
    return nttPrice.add(execCost).toString();
  }

  /**
   * Format cost for display
   * @param cost Cost in wei
   * @returns Formatted cost string
   */
  formatCost(cost: string): string {
    const costEth = ethers.utils.formatEther(cost);
    return `${costEth} ETH (${cost} wei)`;
  }
}

/**
 * Default executor service instance
 */
export const executorService = new ExecutorService();
