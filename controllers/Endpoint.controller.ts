/**
 * EndpointController: Handles deposit-related HTTP endpoints for chains without L2 contract listeners.
 *
 * This controller provides RESTful endpoints for deposit initialization, status checking, and related operations.
 * It uses Zod for request validation, robust logging, and integrates with the chain handler abstraction.
 *
 * Update this file to add, refactor, or clarify endpoint logic for cross-chain deposit flows.
 */
import type { Request, Response } from 'express';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface.js';
import { createDeposit, getDepositId } from '../utils/Deposits.js';
import logger, { logErrorContext } from '../utils/Logger.js';
import { logApiRequest, logDepositError } from '../utils/AuditLog.js';
import { type DepositStatus } from '../types/DepositStatus.enum.js';
import { getFundingTxHash } from '../utils/GetTransactionHash.js';
import type { Reveal } from '../types/Reveal.type.js';
import { DepositStore } from '../utils/DepositStore.js';
import { toSerializableError } from '../types/Error.types.js';
import { stringifyBigIntsInObject } from '../utils/jsonHelpers.js';
import { ZodError } from 'zod';
import { RevealEndpointBodySchema } from '../config/schemas/request.schema';

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
   * @param req Express request object
   * @param res Express response object
   */
  async handleReveal(req: Request, res: Response): Promise<void> {
    const chainNameForLogging = this.chainHandler.config.chainName;
    let fundingTxHashForLogging: string | null = null;

    try {
      logger.debug('Received reveal data via endpoint');

      // Validate and extract data from request body using Zod
      const parseResult = RevealEndpointBodySchema.safeParse(req.body);

      if (!parseResult.success) {
        logger.warn('Reveal request body validation failed:', {
          errors: parseResult.error.flatten(),
          body: req.body,
        });
        // Restore original fundingTxHashForLogging assignment
        fundingTxHashForLogging = req.body.fundingTx?.txHash ?? 'unknown-fundingtx';

        // Restore logApiRequest call with await
        await logApiRequest(
          `/api/${chainNameForLogging}/reveal`,
          'POST',
          fundingTxHashForLogging, // Use original variable
          { validationError: parseResult.error.flatten() },
          400,
          chainNameForLogging,
        );

        res.status(400).json({
          success: false,
          error: 'Invalid request body format.',
          details: parseResult.error.flatten(),
        });
        return;
      }

      // If validation is successful, use the parsed data
      const { fundingTx, reveal, l2DepositOwner, l2Sender } = parseResult.data;
      fundingTxHashForLogging = getFundingTxHash(fundingTx); // Now we have valid fundingTx

      // Log API request (successful validation part)
      logApiRequest(
        `/api/${chainNameForLogging}/reveal`,
        'POST',
        fundingTxHashForLogging,
        {},
        200, // Placeholder, actual success/failure is determined later
        chainNameForLogging,
      );

      const revealData: Reveal = reveal;

      const depositId = getDepositId(fundingTxHashForLogging, revealData.fundingOutputIndex);
      logger.info(
        `Received L2 DepositInitialized event | ID: ${depositId} | Owner: ${l2DepositOwner}`,
      );

      const existingDeposit = await DepositStore.getById(depositId);
      if (existingDeposit) {
        logger.warn(
          `L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
        );
        // Ensure to return a response if the deposit already exists and we're skipping.
        // Sending a 200 with a specific message or a 409 Conflict might be appropriate.
        // For now, let's send a 200 to indicate the request was processed, even if it's a no-op locally.
        res.status(200).json({
          success: true,
          depositId: existingDeposit.id,
          message: 'Deposit already processed or recognized.',
          existing: true,
        });
        return;
      }

      // Create deposit object
      const deposit = createDeposit(
        fundingTx,
        revealData,
        l2DepositOwner,
        l2Sender,
        this.chainHandler.config.chainName,
      );
      logger.debug(`Created deposit with ID: ${deposit.id}`);

      // Initialize the deposit
      const transactionReceipt = await this.chainHandler.initializeDeposit(deposit);

      // Return success
      res.status(200).json({
        success: true,
        depositId: deposit.id,
        message: 'Deposit initialized successfully',
        receipt: stringifyBigIntsInObject(transactionReceipt),
      });
    } catch (error: unknown) {
      logErrorContext('Error handling reveal endpoint:', error);
      // Ensure chainName is available for logging, even if error occurs before this.chainHandler is accessed
      const chainName = this.chainHandler?.config?.chainName || 'unknown-chain';

      // Log error to audit log
      // Use fundingTxHashForLogging which might have been set earlier
      const depositIdForErrorLog =
        fundingTxHashForLogging || req.body.fundingTx?.txHash || 'unknown-deposit';
      const errorExtra = toSerializableError(error);
      logDepositError(
        depositIdForErrorLog,
        'Error handling reveal endpoint',
        errorExtra,
        chainName,
      );
      logApiRequest(
        `/api/${chainName}/reveal`,
        'POST',
        depositIdForErrorLog,
        { error: errorExtra.message },
        500,
        chainName,
      );

      if (error instanceof ZodError) {
        // Should have been caught by safeParse, but as a fallback
        res.status(400).json({
          success: false,
          error: 'Invalid reveal data format.',
          details: error.flatten(),
        });
      } else {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error initializing deposit',
        });
      }
    }
  }

  /**
   * Get the status of a deposit
   * @param req Express request object
   * @param res Express response object
   */
  async getDepositStatus(req: Request, res: Response): Promise<void> {
    try {
      const { depositId } = req.params;
      const chainName = this.chainHandler.config.chainName;

      // Log API request
      logApiRequest(`/api/${chainName}/deposit/${depositId}`, 'GET', depositId, {}, 200, chainName);

      if (!depositId) {
        logApiRequest(
          `/api/${chainName}/deposit/:depositId`,
          'GET',
          'missing-id',
          {},
          400,
          chainName,
        );

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
    } catch (error: unknown) {
      logErrorContext('Error getting deposit status:', error);
      const chainName = this.chainHandler.config.chainName;

      // Log error to audit log
      const depositIdFromParam = req.params.depositId || 'unknown';
      const errorExtra = toSerializableError(error);
      logDepositError(depositIdFromParam, 'Error getting deposit status', errorExtra, chainName);
      logApiRequest(
        `/api/${chainName}/deposit/${depositIdFromParam}`,
        'GET',
        depositIdFromParam,
        {},
        500,
        chainName,
      );

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting deposit status',
      });
    }
  }
}
