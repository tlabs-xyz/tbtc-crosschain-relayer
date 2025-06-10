import type { Request, Response } from 'express';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { createDeposit, getDepositId } from '../utils/Deposits.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { logApiRequest, logDepositError } from '../utils/AuditLog.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import { DepositStore } from '../utils/DepositStore.js';
import { RevealRequestSchema } from '../config/schemas/endpoint.request.schema.js';

/**
 * Controller for handling deposits via HTTP endpoints for chains without L2 contract listeners
 */
/**
 * Controller for handling deposit-related API endpoints.
 * Provides functionality to initialize deposits through REST API calls.
 */
export class EndpointController {
  private chainHandler: ChainHandlerInterface;

  /**
   * Creates a new EndpointController instance.
   * @param chainHandler The chain handler implementation to use for deposit processing
   */
  constructor(chainHandler: ChainHandlerInterface) {
    this.chainHandler = chainHandler;
  }

  /**
   * Handle the reveal data for initializing a deposit.
   *
   * This endpoint accepts Bitcoin funding transaction data and reveal parameters
   * to initiate a deposit on the configured L2 chain.
   *
   * @param req Express request object containing fundingTx, reveal, l2DepositOwner, and l2Sender
   * @param res Express response object
   */
  async handleReveal(req: Request, res: Response): Promise<void> {
    const logApiData = {
      fundingTxHash: req.body.fundingTx ? getFundingTxHash(req.body.fundingTx) : 'unknown',
    };
    logApiRequest('/api/reveal', 'POST', null, logApiData);

    try {
      // Validate request body against the schema
      const validationResult = RevealRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        const error = 'Invalid request body';
        logger.error(
          `[${this.chainHandler.config.chainName}] ${error}: ${validationResult.error.flatten()}`,
        );
        logApiRequest('/api/reveal', 'POST', null, logApiData, 400);

        res.status(400).json({
          success: false,
          error,
          details: validationResult.error.flatten(),
        });
        return;
      }

      // Use the validated data from now on
      const { fundingTx, reveal, l2DepositOwner, l2Sender } = validationResult.data;

      const fundingTxHash = getFundingTxHash(fundingTx);
      const depositId = getDepositId(fundingTxHash, reveal.fundingOutputIndex);
      logger.info(
        `[${this.chainHandler.config.chainName}] Received L2 DepositInitialized event | ID: ${depositId} | Owner: ${l2DepositOwner}`,
      );

      const existingDeposit = await DepositStore.getById(depositId);
      if (existingDeposit) {
        logger.warn(
          `[${this.chainHandler.config.chainName}] L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
        );
        res.status(409).json({
          success: false,
          error: 'Deposit already exists',
          depositId: depositId,
        });
        return;
      }

      // Create deposit object
      const deposit = createDeposit(
        fundingTx,
        reveal,
        l2DepositOwner,
        l2Sender,
        this.chainHandler.config.chainName,
      );
      logger.debug(
        `[${this.chainHandler.config.chainName}] Created deposit with ID: ${deposit.id}`,
      );

      // Save deposit to database before initializing
      try {
        await DepositStore.create(deposit);
        logger.info(
          `[${this.chainHandler.config.chainName}] Deposit saved to database with ID: ${deposit.id}`,
        );
      } catch (error: any) {
        logger.error(
          `[${this.chainHandler.config.chainName}] Failed to save deposit to database: ${error.message}`,
        );
        logDepositError(
          depositId,
          `[${this.chainHandler.config.chainName}] Failed to save deposit to database`,
          error,
        );

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
        logger.error(
          `[${this.chainHandler.config.chainName}] Deposit initialization failed for ID: ${deposit.id}`,
        );
        res.status(500).json({
          success: false,
          error: 'Deposit initialization failed',
          depositId: deposit.id,
          message: 'Deposit was saved but initialization on L1 failed',
        });
      }
    } catch (error: any) {
      logErrorContext(
        `[${this.chainHandler.config.chainName}] Error handling reveal endpoint:`,
        error,
        { chainName: this.chainHandler.config.chainName },
      );

      // Log error to audit log
      const depositId = req.body.fundingTx ? getFundingTxHash(req.body.fundingTx) : 'unknown';
      logDepositError(
        depositId,
        `[${this.chainHandler.config.chainName}] Error handling reveal endpoint`,
        error,
      );
      logApiRequest('/api/reveal', 'POST', depositId, {}, 500);

      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error initializing deposit',
        depositId: depositId,
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
      logErrorContext(
        `[${this.chainHandler.config.chainName}] Error getting deposit status:`,
        error,
        { chainName: this.chainHandler.config.chainName },
      );

      // Log error to audit log
      const depositId = req.params.depositId || 'unknown';
      logDepositError(
        depositId,
        `[${this.chainHandler.config.chainName}] Error getting deposit status`,
        error,
      );
      logApiRequest('/api/deposit/:depositId', 'GET', depositId, {}, 500);

      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error getting deposit status',
        depositId,
      });
    }
  }
}
