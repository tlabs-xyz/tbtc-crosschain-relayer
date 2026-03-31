import { BigNumber } from 'ethers';
import type { Request, Response } from 'express';
import {
  DepositNotificationSchema,
  RevealRequestSchema,
} from '../config/schemas/endpoint.request.schema.js';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { DepositStatus } from '../types/DepositStatus.enum.js';
import { logApiRequest, logDepositError } from '../utils/AuditLog.js';
import { DepositStore } from '../utils/DepositStore.js';
import { createDeposit, createDepositFromNotification, getDepositId } from '../utils/Deposits.js';
import { getTransactionHash } from '../utils/GetTransactionHash.js';
import logger, { logErrorContext } from '../utils/Logger.js';

/**
 * Controller for handling deposit-related API endpoints.
 * Provides functionality to initialize deposits through REST API calls.
 *
 * Requires express.json() body parsing middleware (configured in app).
 * Request bodies are validated using zod schemas before processing.
 */
export class EndpointController {
  private chainHandler: ChainHandlerInterface;
  private readonly chainName: string;

  /**
   * Creates a new EndpointController instance.
   * @param chainHandler The chain handler implementation to use for deposit processing
   */
  constructor(chainHandler: ChainHandlerInterface) {
    this.chainHandler = chainHandler;
    this.chainName = chainHandler.config.chainName;
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
    // Initialize fundingTxHash safely before validation to avoid throwing outside try/catch
    let fundingTxHash = 'unknown';
    const logApiData = {
      fundingTxHash: fundingTxHash,
    };
    logApiRequest('/api/reveal', 'POST', null, logApiData);

    try {
      // Validate request body against the schema
      const validationResult = RevealRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        const error = 'Invalid request body';
        logger.error(`[${this.chainName}] ${error}: ${validationResult.error?.flatten()}`);
        logApiRequest('/api/reveal', 'POST', null, logApiData, 400);

        res.status(400).json({
          success: false,
          error,
          details: validationResult.error?.flatten(),
        });
        return;
      }

      // Use the validated data from now on
      const { fundingTx, reveal, l2DepositOwner, l2Sender } = validationResult.data;

      // Use getTransactionHash() which returns little-endian (Bitcoin display format)
      // Then getDepositId() will reverse it to big-endian for keccak256 calculation
      fundingTxHash = '0x' + getTransactionHash(fundingTx);
      const depositId = getDepositId(fundingTxHash, reveal.fundingOutputIndex);
      logger.info(
        `[${this.chainName}] Received L2 DepositInitialized event | ID: ${depositId} | Owner: ${l2DepositOwner}`,
      );

      const existingDeposit = await DepositStore.getById(depositId);
      if (existingDeposit) {
        logger.warn(
          `[${this.chainName}] L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
        );
        res.status(409).json({
          success: false,
          error: 'Deposit already exists',
          depositId: depositId,
        });
        return;
      }

      // Create deposit object
      const deposit = createDeposit(fundingTx, reveal, l2DepositOwner, l2Sender, this.chainName);
      logger.debug(`[${this.chainName}] Created deposit with ID: ${deposit.id}`);

      // Save deposit to database before initializing
      try {
        await DepositStore.create(deposit);
        logger.info(`[${this.chainName}] Deposit saved to database with ID: ${deposit.id}`);
      } catch (error: any) {
        logger.error(`[${this.chainName}] Failed to save deposit to database: ${error.message}`);
        logDepositError(depositId, `[${this.chainName}] Failed to save deposit to database`, error);

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
        logger.error(`[${this.chainName}] Deposit initialization failed for ID: ${deposit.id}`);
        res.status(500).json({
          success: false,
          error: 'Deposit initialization failed',
          depositId: deposit.id,
          message: 'Deposit was saved but initialization on L1 failed',
        });
      }
    } catch (error: any) {
      logErrorContext(`[${this.chainName}] Error handling reveal endpoint:`, error, {
        chainName: this.chainName,
      });

      // Log error to audit log
      // Use fundingTxHash if it was computed successfully, otherwise 'unknown'
      const depositId = fundingTxHash;
      logDepositError(depositId, `[${this.chainName}] Error handling reveal endpoint`, error);
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
      logErrorContext(`[${this.chainName}] Error getting deposit status:`, error, {
        chainName: this.chainName,
      });

      // Log error to audit log
      const depositId = req.params.depositId || 'unknown';
      logDepositError(depositId, `[${this.chainName}] Error getting deposit status`, error);
      logApiRequest('/api/deposit/:depositId', 'GET', depositId, {}, 500);

      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error getting deposit status',
        depositId,
      });
    }
  }

  /**
   * Handle notification from backend that a deposit was already initialized.
   * This is for the gasless flow where the backend initializes on L1,
   * then notifies the relayer to track the deposit for finalization.
   *
   * POST /api/:chainName/deposit/notify
   *
   * Flow:
   * 1. Validate request body schema
   * 2. Verify depositKey matches fundingTx + reveal (prevent spoofing)
   * 3. Check if deposit already exists (idempotency)
   * 4. Verify deposit is initialized on-chain (security)
   * 5. Create deposit record with status=INITIALIZED
   * 6. Return success
   *
   * @param req Express request object containing depositKey, fundingTx, reveal, destinationChainDepositOwner, initTxHash
   * @param res Express response object
   */
  async handleDepositNotification(req: Request, res: Response): Promise<void> {
    // Extract and normalize depositKey once at the top
    const depositKey = req.body?.depositKey ?? '';
    const logApiData = {
      depositKey: depositKey || 'unknown',
      chainName: this.chainName,
    };
    logApiRequest('/api/deposit/notify', 'POST', depositKey, logApiData);

    try {
      // 1. Validate request body
      const validationResult = DepositNotificationSchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.error(
          `[${this.chainName}] Invalid deposit notification: ${validationResult.error?.flatten()}`,
        );
        logApiRequest('/api/deposit/notify', 'POST', depositKey, logApiData, 400);

        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: validationResult.error?.flatten(),
        });
        return;
      }

      const {
        depositKey: depositKeyRaw,
        fundingTx,
        reveal,
        destinationChainDepositOwner,
        initTxHash,
        backendAddress,
      } = validationResult.data;

      // Normalize depositKey to decimal format (relayer's internal representation)
      // Backend sends hex string (0x...), but relayer stores deposits with decimal string IDs
      // BigNumber.from() accepts both hex and decimal, .toString() normalizes to decimal
      const normalizedDepositKey = BigNumber.from(depositKeyRaw).toString();

      // 2. Verify depositKey matches fundingTx + reveal
      // Use getTransactionHash() which returns little-endian (Bitcoin display format)
      // Then getDepositId() will reverse it to big-endian for keccak256 calculation
      // This matches the reference implementation and on-chain contract behavior
      const fundingTxHash = '0x' + getTransactionHash(fundingTx);
      const calculatedDepositId = getDepositId(fundingTxHash, reveal.fundingOutputIndex);

      if (calculatedDepositId !== normalizedDepositKey) {
        logger.error(
          `[${this.chainName}] depositKey mismatch: provided=${normalizedDepositKey}, calculated=${calculatedDepositId}`,
        );
        res.status(400).json({
          success: false,
          error: 'depositKey does not match fundingTx and reveal',
          providedKey: normalizedDepositKey,
          calculatedKey: calculatedDepositId,
        });
        return;
      }

      // 3. Check if deposit already exists
      const existingDeposit = await DepositStore.getById(normalizedDepositKey);
      if (existingDeposit) {
        logger.warn(
          `[${this.chainName}] Deposit already exists | ID: ${normalizedDepositKey} | Status: ${DepositStatus[existingDeposit.status]}`,
        );
        res.status(200).json({
          success: true,
          message: 'Deposit already registered',
          depositId: normalizedDepositKey,
          status: DepositStatus[existingDeposit.status],
        });
        return;
      }

      // 4. Verify deposit is initialized on-chain
      const onChainStatus = await this.chainHandler.checkDepositStatus(normalizedDepositKey);

      if (onChainStatus === null) {
        logger.error(
          `[${this.chainName}] Could not verify deposit on-chain | ID: ${normalizedDepositKey}`,
        );
        res.status(503).json({
          success: false,
          error: 'Could not verify deposit status on-chain',
          depositId: normalizedDepositKey,
          message: 'Relayer may be experiencing RPC issues. Please retry.',
        });
        return;
      }

      if (onChainStatus !== DepositStatus.INITIALIZED) {
        logger.error(
          `[${this.chainName}] Deposit not initialized on-chain | ID: ${normalizedDepositKey} | Status: ${DepositStatus[onChainStatus]}`,
        );
        res.status(400).json({
          success: false,
          error: 'Deposit is not in INITIALIZED state on-chain',
          depositId: normalizedDepositKey,
          onChainStatus: DepositStatus[onChainStatus],
          message:
            onChainStatus === DepositStatus.QUEUED
              ? 'Deposit not found on-chain. Initialization transaction may not be mined yet.'
              : `Deposit is already ${DepositStatus[onChainStatus]} on-chain.`,
        });
        return;
      }

      // 5. Create deposit record in database
      const deposit = createDepositFromNotification(
        normalizedDepositKey,
        fundingTx,
        reveal,
        destinationChainDepositOwner,
        initTxHash,
        backendAddress,
        this.chainName,
      );

      logger.info(
        `[${this.chainName}] Creating deposit from backend notification | ID: ${normalizedDepositKey}`,
      );

      await DepositStore.create(deposit);

      logger.info(
        `[${this.chainName}] Deposit created successfully from notification | ID: ${normalizedDepositKey}`,
      );
      logApiRequest('/api/deposit/notify', 'POST', normalizedDepositKey, logApiData, 200);

      // 6. Return success
      res.status(200).json({
        success: true,
        depositId: normalizedDepositKey,
        message: 'Deposit registered. Relayer will finalize in 5-60 minutes.',
        onChainStatus: 'INITIALIZED',
      });
    } catch (error: any) {
      logErrorContext(`[${this.chainName}] Error handling deposit notification:`, error);
      logDepositError(depositKey || 'unknown', `Error handling deposit notification`, error);
      logApiRequest('/api/deposit/notify', 'POST', depositKey, {}, 500);

      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error',
        depositId: depositKey,
      });
    }
  }
}
