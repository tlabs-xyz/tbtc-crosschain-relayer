import type { Request, Response } from 'express';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { createDeposit, getDepositId } from '../utils/Deposits.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { logApiRequest, logDepositError } from '../utils/AuditLog.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import type { Reveal } from '../types/Reveal.type.js';
import { DepositStore } from '../utils/DepositStore.js';

/**
 * Controller for handling deposits via HTTP endpoints for chains without L2 contract listeners
 */
export class EndpointController {
  private chainHandler: ChainHandlerInterface;

  constructor(chainHandler: ChainHandlerInterface) {
    this.chainHandler = chainHandler;
  }

  /**
   * Handle the reveal data for initializing a deposit
   */
  async handleReveal(req: Request, res: Response): Promise<void> {
    try {
      logger.debug('Received reveal data via endpoint');

      // Extract data from request body
      const { fundingTx, reveal, l2DepositOwner, l2Sender, destinationChainDepositOwner } =
        req.body;

      // Log API request
      logApiRequest('/api/reveal', 'POST', null, {
        fundingTxHash: fundingTx ? fundingTx.txHash : null,
      });

      // Validate required fields
      if (!fundingTx || !reveal || !l2DepositOwner || !l2Sender) {
        const error = 'Missing required fields in request body';
        logApiRequest(
          '/api/reveal',
          'POST',
          null,
          {
            fundingTxHash: fundingTx ? fundingTx.txHash : null,
          },
          400,
        );

        res.status(400).json({
          success: false,
          error,
        });
        return;
      }
      const revealData: Reveal = reveal as Reveal;

      const fundingTxHash = getFundingTxHash(fundingTx);
      const depositId = getDepositId(fundingTxHash, revealData.fundingOutputIndex);
      logger.info(
        `Received L2 DepositInitialized event | ID: ${depositId} | Owner: ${l2DepositOwner}`,
      );

      const existingDeposit = await DepositStore.getById(depositId);
      if (existingDeposit) {
        logger.warn(
          `L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
        );
        res.status(409).json({
          success: false,
          error: 'Deposit already exists',
          depositId: depositId,
        });
        return;
      }

      // Create deposit object
      // For StarkNet, use destinationChainDepositOwner if provided, otherwise fall back to l2DepositOwner
      const depositOwner = destinationChainDepositOwner || l2DepositOwner;
      const deposit = createDeposit(
        fundingTx,
        revealData,
        depositOwner,
        l2Sender,
        this.chainHandler.config.chainName,
      );
      logger.debug(`Created deposit with ID: ${deposit.id}`);

      // Save deposit to database before initializing
      try {
        await DepositStore.create(deposit);
        logger.info(`Deposit saved to database with ID: ${deposit.id}`);
      } catch (error: any) {
        logger.error(`Failed to save deposit to database: ${error.message}`);
        logDepositError(depositId, 'Failed to save deposit to database', error);

        res.status(500).json({
          success: false,
          error: 'Failed to save deposit to database',
          depositId: deposit.id,
        });
        return;
      }

      // Initialize the deposit
      const transactionReceipt = await this.chainHandler.initializeDeposit(deposit);

      // Check if initialization was successful
      if (transactionReceipt) {
        // Return success only if initialization succeeded
        res.status(200).json({
          success: true,
          depositId: deposit.id,
          message: 'Deposit initialized successfully',
          receipt: transactionReceipt,
        });
      } else {
        // Initialization failed
        logger.error(`Deposit initialization failed for ID: ${deposit.id}`);
        res.status(500).json({
          success: false,
          error: 'Deposit initialization failed',
          depositId: deposit.id,
          message: 'Deposit was saved but initialization on L1 failed',
        });
      }
    } catch (error: any) {
      logErrorContext('Error handling reveal endpoint:', error);

      // Log error to audit log
      const depositId = req.body.fundingTx?.txHash || 'unknown';
      logDepositError(depositId, 'Error handling reveal endpoint', error);
      logApiRequest('/api/reveal', 'POST', depositId, {}, 500);

      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error initializing deposit',
      });
    }
  }

  /**
   * Get the status of a deposit
   */
  async getDepositStatus(req: Request, res: Response): Promise<void> {
    try {
      const { depositId } = req.params;

      // Log API request
      logApiRequest('/api/deposit/:depositId', 'GET', depositId);

      if (!depositId) {
        logApiRequest('/api/deposit/:depositId', 'GET', 'missing-id', {}, 400);

        res.status(400).json({
          success: false,
          error: 'Missing depositId parameter',
        });
        return;
      }

      const numericStatus: DepositStatus | null =
        await this.chainHandler.checkDepositStatus(depositId);

      if (numericStatus === null) {
        res.status(404).json({ success: false, message: 'Deposit not found' });
        return;
      }

      res.status(200).json({
        success: true,
        depositId,
        status: numericStatus,
      });
    } catch (error: any) {
      logErrorContext('Error getting deposit status:', error);

      // Log error to audit log
      const depositId = req.params.depositId || 'unknown';
      logDepositError(depositId, 'Error getting deposit status', error);
      logApiRequest('/api/deposit/:depositId', 'GET', depositId, {}, 500);

      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error getting deposit status',
      });
    }
  }
}
