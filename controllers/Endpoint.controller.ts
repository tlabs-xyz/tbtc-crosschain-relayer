import type { Request, Response } from 'express';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface';
import { createDeposit, getDepositId } from '../utils/Deposits';
import logger, { logErrorContext } from '../utils/Logger';
import { logApiRequest, logDepositError } from '../utils/AuditLog';
import { DepositStatus } from '../types/DepositStatus.enum';
import { getFundingTxHash } from '../utils/GetTransactionHash';
import type { Reveal } from '../types/Reveal.type';
import { DepositStore } from '../utils/DepositStore';

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
      const chainName = this.chainHandler.config.chainName;

      // Extract data from request body
      const { fundingTx, reveal, l2DepositOwner, l2Sender } = req.body;

      // Log API request
      logApiRequest(
        `/api/${chainName}/reveal`,
        'POST',
        null,
        {
          fundingTxHash: fundingTx ? fundingTx.txHash : null,
        },
        200,
        chainName,
      );

      // Validate required fields
      if (!fundingTx || !reveal || !l2DepositOwner || !l2Sender) {
        const error = 'Missing required fields in request body';
        logApiRequest(
          `/api/${chainName}/reveal`,
          'POST',
          null,
          {
            fundingTxHash: fundingTx ? fundingTx.txHash : null,
          },
          400,
          chainName,
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
        receipt: transactionReceipt,
      });
    } catch (error: any) {
      logErrorContext('Error handling reveal endpoint:', error);
      const chainName = this.chainHandler.config.chainName;

      // Log error to audit log
      const depositId = req.body.fundingTx?.txHash || 'unknown';
      logDepositError(depositId, 'Error handling reveal endpoint', error, chainName);
      logApiRequest(`/api/${chainName}/reveal`, 'POST', depositId, {}, 500, chainName);

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
    } catch (error: any) {
      logErrorContext('Error getting deposit status:', error);
      const chainName = this.chainHandler.config.chainName;

      // Log error to audit log
      const depositIdFromParam = req.params.depositId || 'unknown';
      logDepositError(depositIdFromParam, 'Error getting deposit status', error, chainName);
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
        error: error.message || 'Unknown error getting deposit status',
      });
    }
  }
}
