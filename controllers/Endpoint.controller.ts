import { Request, Response } from "express";
import { ChainHandlerInterface } from "../interfaces/ChainHandler.interface";
import { createDeposit } from "../utils/Deposits";
import { LogError, LogMessage } from "../utils/Logs";

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
      LogMessage("Received reveal data via endpoint");
      
      // Extract data from request body
      const { fundingTx, reveal, l2DepositOwner, l2Sender } = req.body;
      
      // Validate required fields
      if (!fundingTx || !reveal || !l2DepositOwner || !l2Sender) {
        res.status(400).json({
          success: false,
          error: "Missing required fields in request body"
        });
        return;
      }
      
      // Create deposit object
      const deposit = createDeposit(fundingTx, reveal, l2DepositOwner, l2Sender);
      LogMessage(`Created deposit with ID: ${deposit.id}`);
      
      // Initialize the deposit
      await this.chainHandler.initializeDeposit(deposit);
      
      // Return success
      res.status(200).json({
        success: true,
        depositId: deposit.id,
        message: "Deposit initialized successfully"
      });
    } catch (error: any) {
      LogError("Error handling reveal endpoint:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error initializing deposit"
      });
    }
  }

  /**
   * Get the status of a deposit
   */
  async getDepositStatus(req: Request, res: Response): Promise<void> {
    try {
      const { depositId } = req.params;
      
      if (!depositId) {
        res.status(400).json({
          success: false,
          error: "Missing depositId parameter"
        });
        return;
      }
      
      const status = await this.chainHandler.checkDepositStatus(depositId);
      
      res.status(200).json({
        success: true,
        depositId,
        status
      });
    } catch (error: any) {
      LogError("Error getting deposit status:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error getting deposit status"
      });
    }
  }
} 