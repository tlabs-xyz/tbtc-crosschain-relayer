import { ethers } from 'ethers';
import logger from '../utils/Logger.js';
import { executorService } from './ExecutorService.js';
import type { Deposit } from '../types/Deposit.type.js';

/**
 * Service for interacting with L1BTCDepositorNttWithExecutor contract
 * Handles the three-step execution flow: initializeDeposit -> setExecutorParameters -> finalizeDeposit
 */
export class L1DepositorService {
  private readonly l1Provider: ethers.providers.JsonRpcProvider;
  private readonly l1Signer: ethers.Wallet;
  private readonly nonceManager: any; // Using any to avoid import issues
  private readonly depositorContract: ethers.Contract;
  private readonly nttManagerWithExecutor: ethers.Contract;
  private readonly underlyingNttManager: ethers.Contract;

  constructor(
    l1RpcUrl: string,
    privateKey: string,
    depositorAddress: string,
    nttManagerWithExecutorAddress: string,
    underlyingNttManagerAddress: string
  ) {
    this.l1Provider = new ethers.providers.JsonRpcProvider(l1RpcUrl);
    this.l1Signer = new ethers.Wallet(privateKey, this.l1Provider);
    // Create a simple nonce manager wrapper
    this.nonceManager = {
      getTransactionCount: async () => await this.l1Signer.getTransactionCount(),
      incrementTransactionCount: () => {},
    };

    // Initialize contracts
    this.depositorContract = new ethers.Contract(
      depositorAddress,
      this.getDepositorABI(),
      this.nonceManager
    );

    this.nttManagerWithExecutor = new ethers.Contract(
      nttManagerWithExecutorAddress,
      this.getNttManagerWithExecutorABI(),
      this.l1Provider
    );

    this.underlyingNttManager = new ethers.Contract(
      underlyingNttManagerAddress,
      this.getNttManagerABI(),
      this.l1Provider
    );
  }

  /**
   * Step 1: Initialize deposit on L1
   * @param deposit Deposit object with Bitcoin transaction details
   * @param recipientAddress Recipient address on destination chain
   * @param destinationChainId Wormhole chain ID of destination
   * @returns Transaction hash
   */
  async initializeDeposit(
    deposit: Deposit,
    recipientAddress: string,
    destinationChainId: number
  ): Promise<string> {
    try {
      logger.info(`Initializing deposit ${deposit.id} for chain ${destinationChainId}`);

      // Encode destination receiver (chain ID + recipient address)
      const encodedReceiver = await this.depositorContract.encodeDestinationReceiver(
        destinationChainId,
        recipientAddress
      );

      // Call initializeDeposit
      const tx = await this.depositorContract.initializeDeposit(
        encodedReceiver,
        {
          gasLimit: 500000, // Conservative gas limit
        }
      );

      logger.info(`Deposit ${deposit.id} initialization transaction: ${tx.hash}`);
      return tx.hash;
    } catch (error: any) {
      logger.error(`Failed to initialize deposit ${deposit.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Step 2: Set executor parameters with signed quote from Wormhole Executor API
   * @param destinationChainId Destination chain ID
   * @param refundAddress User's address to receive refunds
   * @param gasLimit Gas limit for destination chain execution
   * @param feeBps Fee in basis points (0-10000)
   * @param feePayee Address to receive fees
   * @returns Nonce hash for the parameters
   */
  async setExecutorParameters(
    destinationChainId: number,
    refundAddress: string,
    gasLimit: number = 500000,
    feeBps: number = 0,
    feePayee: string = ethers.constants.AddressZero
  ): Promise<string> {
    try {
      logger.info(`Setting executor parameters for chain ${destinationChainId}`);

      // Generate relay instructions
      const relayInstructions = executorService.generateRelayInstructions(gasLimit);

      // Get signed quote from Wormhole Executor API
      const { executorArgs, estimatedCost } = await executorService.generateExecutorParameters(
        2, // Ethereum source chain
        destinationChainId,
        refundAddress,
        relayInstructions
      );

      // Generate fee args
      const feeArgs = executorService.generateFeeArgs(feeBps, feePayee);

      // Validate parameters
      executorService.validateExecutorParameters(executorArgs, feeArgs);

      logger.info(`Executor cost: ${executorService.formatCost(estimatedCost)}`);

      // Set executor parameters on contract
      const tx = await this.depositorContract.setExecutorParameters(executorArgs, feeArgs);
      await tx.wait();

      // Get the nonce for these parameters
      const [isSet, nonce] = await this.depositorContract.areExecutorParametersSet();
      
      if (!isSet) {
        throw new Error('Failed to set executor parameters');
      }

      logger.info(`Executor parameters set with nonce: ${nonce}`);
      return nonce;
    } catch (error: any) {
      logger.error(`Failed to set executor parameters: ${error.message}`);
      throw error;
    }
  }

  /**
   * Step 3: Finalize deposit with executor payment
   * @param deposit Deposit object
   * @param executorPaymentValue ETH value to pay for executor service
   * @returns Transaction receipt
   */
  async finalizeDeposit(
    deposit: Deposit,
    executorPaymentValue: string
  ): Promise<ethers.providers.TransactionReceipt> {
    try {
      logger.info(`Finalizing deposit ${deposit.id} with executor payment: ${executorService.formatCost(executorPaymentValue)}`);

      // Get deposit key
      const depositKey = await this.getDepositKey(deposit);

      // Quote the total cost first
      const totalCost = await this.depositorContract.quoteFinalizeDeposit();
      logger.info(`Total cost for finalization: ${executorService.formatCost(totalCost.toString())}`);

      // Check if we have sufficient balance
      const balance = await this.l1Signer.getBalance();
      const requiredBalance = ethers.BigNumber.from(executorPaymentValue).add(totalCost);
      
      if (balance.lt(requiredBalance)) {
        throw new Error(
          `Insufficient balance. Required: ${executorService.formatCost(requiredBalance.toString())}, ` +
          `Have: ${executorService.formatCost(balance.toString())}`
        );
      }

      // Finalize deposit
      const tx = await this.depositorContract.finalizeDeposit(depositKey, {
        value: executorPaymentValue,
        gasLimit: 800000, // Higher gas limit for complex operation
      });

      logger.info(`Deposit ${deposit.id} finalization transaction: ${tx.hash}`);
      
      const receipt = await tx.wait();
      logger.info(`Deposit ${deposit.id} finalized successfully`);

      return receipt;
    } catch (error: any) {
      logger.error(`Failed to finalize deposit ${deposit.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Complete the three-step deposit flow
   * @param deposit Deposit object
   * @param recipientAddress Recipient address on destination chain
   * @param destinationChainId Destination chain ID
   * @param refundAddress User's address to receive refunds
   * @param gasLimit Gas limit for destination chain execution
   * @param feeBps Fee in basis points
   * @param feePayee Address to receive fees
   * @returns Final transaction receipt
   */
  async completeDepositFlow(
    deposit: Deposit,
    recipientAddress: string,
    destinationChainId: number,
    refundAddress: string,
    gasLimit: number = 500000,
    feeBps: number = 0,
    feePayee: string = ethers.constants.AddressZero
  ): Promise<ethers.providers.TransactionReceipt> {
    try {
      logger.info(`Starting complete deposit flow for ${deposit.id}`);

      // Step 1: Initialize deposit
      const initTxHash = await this.initializeDeposit(deposit, recipientAddress, destinationChainId);
      logger.info(`Step 1 completed: ${initTxHash}`);

      // Step 2: Set executor parameters
      const nonce = await this.setExecutorParameters(destinationChainId, refundAddress, gasLimit, feeBps, feePayee);
      logger.info(`Step 2 completed: ${nonce}`);

      // Get executor cost for finalization
      const executorCost = await this.depositorContract.getStoredExecutorValue();
      logger.info(`Executor cost for finalization: ${executorService.formatCost(executorCost.toString())}`);

      // Step 3: Finalize deposit
      const receipt = await this.finalizeDeposit(deposit, executorCost.toString());
      logger.info(`Step 3 completed: ${receipt.transactionHash}`);

      return receipt;
    } catch (error: any) {
      logger.error(`Complete deposit flow failed for ${deposit.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get detailed cost breakdown for a transfer
   * @param destinationChainId Destination chain ID
   * @returns Cost breakdown
   */
  async getCostBreakdown(destinationChainId: number): Promise<{
    nttDeliveryPrice: string;
    executorCost: string;
    totalCost: string;
  }> {
    try {
      const [nttDeliveryPrice, executorCost, totalCost] = await this.depositorContract.quoteFinalizedDeposit(destinationChainId);
      
      return {
        nttDeliveryPrice: nttDeliveryPrice.toString(),
        executorCost: executorCost.toString(),
        totalCost: totalCost.toString(),
      };
    } catch (error: any) {
      logger.error(`Failed to get cost breakdown: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if executor parameters are set for current user
   * @returns Parameters status
   */
  async areExecutorParametersSet(): Promise<{ isSet: boolean; nonce: string }> {
    const [isSet, nonce] = await this.depositorContract.areExecutorParametersSet();
    return { isSet, nonce };
  }

  /**
   * Clear executor parameters for current user
   */
  async clearExecutorParameters(): Promise<void> {
    await this.depositorContract.clearExecutorParameters();
    logger.info('Executor parameters cleared');
  }

  /**
   * Get deposit key for a deposit object
   * @param deposit Deposit object
   * @returns Deposit key as bytes32
   */
  private async getDepositKey(deposit: Deposit): Promise<string> {
    // This would need to be implemented based on your deposit key generation logic
    // For now, returning a placeholder
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(deposit.id));
  }

  /**
   * Get L1BTCDepositorNttWithExecutor ABI
   * @returns Contract ABI
   */
  private getDepositorABI(): any[] {
    // This would contain the actual ABI for L1BTCDepositorNttWithExecutor
    // For now, returning a minimal ABI with required functions
    return [
      'function initializeDeposit(bytes32 encodedReceiver) external',
      'function setExecutorParameters((uint256,address,bytes,bytes) executorArgs, (uint16,address) feeArgs) external returns (bytes32)',
      'function finalizeDeposit(bytes32 depositKey) external payable',
      'function quoteFinalizeDeposit() external view returns (uint256)',
      'function quoteFinalizedDeposit(uint16 destinationChain) external view returns (uint256, uint256, uint256)',
      'function areExecutorParametersSet() external view returns (bool, bytes32)',
      'function getStoredExecutorValue() external view returns (uint256)',
      'function clearExecutorParameters() external',
      'function encodeDestinationReceiver(uint16 chainId, address recipient) external pure returns (bytes32)',
      'function decodeDestinationReceiver(bytes32 encodedReceiver) external pure returns (uint16, address)',
    ];
  }

  /**
   * Get NttManagerWithExecutor ABI
   * @returns Contract ABI
   */
  private getNttManagerWithExecutorABI(): any[] {
    return [
      'function transfer(address nttManager, uint256 amount, uint16 recipientChain, bytes32 recipientAddress, bytes32 refundAddress, bytes encodedInstructions, (uint256,address,bytes,bytes) executorArgs, (uint16,address) feeArgs) external payable returns (uint64)',
      'function quoteDeliveryPrice(address nttManager, uint16 recipientChain, bytes encodedInstructions, (uint256,address,bytes,bytes) executorArgs, (uint16,address) feeArgs) external view returns (uint256)',
    ];
  }

  /**
   * Get NttManager ABI
   * @returns Contract ABI
   */
  private getNttManagerABI(): any[] {
    return [
      'function quoteDeliveryPrice(uint16 recipientChain, bytes transceiverInstructions) external view returns (uint256[], uint256)',
      'function token() external view returns (address)',
      'function getPeer(uint16 chainId) external view returns (address, uint8)',
      'function tokenDecimals() external view returns (uint8)',
    ];
  }
}
