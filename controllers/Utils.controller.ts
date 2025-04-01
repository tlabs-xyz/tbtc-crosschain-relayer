import { Request, Response } from 'express';
import CustomResponse from '../helpers/CustomResponse.helper';
import { LogError } from '../utils/Logs';
import fs from 'fs';
import path from 'path';

export default class Utils {
  /**
   * @name defaultController
   * @description Default controller
   * @method GET
   * @returns {Object} API information
   */
  defaultController = (req: Request, res: Response): void => {
    const response = new CustomResponse(res);

    // Get API version
    const version = process.env.APP_VERSION || '1.0.0';

    // Get API name
    const name = process.env.APP_NAME || 'Unknown API';

    // Send response
    return response.ok('API Information: ', {
      name,
      version,
    });
  };

  /**
   * @name pingController
   * @description Check if API is running
   * @method GET
   * @returns {Object} API status
   **/
  pingController = async (req: Request, res: Response): Promise<void> => {
    const response = new CustomResponse(res);

    try {
      return response.ok();
    } catch (err) {
      LogError('🚀 ~ pingController ~ err:', err as Error);
      return response.ko((err as Error).message);
    }
  };

  /**
   * Get audit logs within a time range
   * @param req Express request
   * @param res Express response
   */
  public auditLogsController = async (req: Request, res: Response) => {
    try {
      const AUDIT_LOG_DIR = process.env.AUDIT_LOG_DIR || './logs';
      const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE || 'deposit_audit.log';
      const AUDIT_LOG_PATH = path.join(AUDIT_LOG_DIR, AUDIT_LOG_FILE);

      // Check if limit is specified in query
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      // Check if depositId filter is specified
      const depositId = req.query.depositId as string;

      // Check if eventType filter is specified
      const eventType = req.query.eventType as string;

      // Check if start date is specified
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string).toISOString()
        : undefined;

      // Check if end date is specified
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string).toISOString()
        : undefined;

      // Check if file exists
      if (!fs.existsSync(AUDIT_LOG_PATH)) {
        return res.status(404).json({
          message: 'Audit log file not found',
        });
      }

      // Read file line by line
      const data = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
      const lines = data.split('\n').filter((line) => line.trim() !== '');

      // Parse JSON and filter
      const logs = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter((log) => log !== null)
        .filter((log) => {
          // Apply depositId filter if specified
          if (depositId && log.depositId !== depositId) {
            return false;
          }

          // Apply eventType filter if specified
          if (eventType && log.eventType !== eventType) {
            return false;
          }

          // Apply date range filter if specified
          if (startDate && log.timestamp < startDate) {
            return false;
          }

          if (endDate && log.timestamp > endDate) {
            return false;
          }

          return true;
        })
        .slice(-limit); // Get the most recent logs up to the limit

      // Return the logs
      return res.status(200).json({
        logs,
        total: logs.length,
        limit,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: 'Error retrieving audit logs',
        error: error.message,
      });
    }
  };
}
