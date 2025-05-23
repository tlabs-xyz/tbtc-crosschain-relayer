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
      const { fundingTx, reveal, l2DepositOwner, l2Sender } = req.body;

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
      const revealArray = Array.isArray(reveal) ? reveal : (Object.values(reveal) as Reveal);
      const fundingOutputIndex = revealArray[0];

      const fundingTxHash = getFundingTxHash(fundingTx);
      const depositId = getDepositId(fundingTxHash, fundingOutputIndex);
      logger.info(
        `Received L2 DepositInitialized event | ID: ${depositId} | Owner: ${l2DepositOwner}`,
      );

      const existingDeposit = await DepositStore.getById(depositId);
      if (existingDeposit) {
        logger.warn(
          `L2 Listener | Deposit already exists locally | ID: ${depositId}. Ignoring event.`,
        );
        return;
      }

      // Create deposit object
      const deposit = createDeposit(fundingTx, reveal, l2DepositOwner, l2Sender, this.chainHandler.config.chainName);
      logger.debug(`Created deposit with ID: ${deposit.id}`);

      // Initialize the deposit
      const transactionReceipt = await this.chainHandler.initializeDeposit(deposit);

      // Return success
      res.status(200).json({
        success: true,
        depositId: deposit.id,
        message: 'Deposit initialized successfully',
        receipt: transactionReceipt,
      });
    } catch (error: any) {
      logErrorContext('Error handling reveal endpoint:', error);

      // Log error to audit log
      let depositId = 'unknown';
      try {
        if (req.body?.fundingTx?.txHash) {
          depositId = req.body.fundingTx.txHash;
        }
      } catch (e) {}

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
