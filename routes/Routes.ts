import express from 'express';
import type { Request, Response } from 'express';

import Operations from '../controllers/Operations.controller.js';
import Utils from '../controllers/Utils.controller.js';
import { EndpointController } from '../controllers/Endpoint.controller.js';
import { chainHandler } from '../services/Core.js';

export const router = express.Router();

// Controllers
const utils = new Utils();
const operations = new Operations();

// Default route for the API
router.get('/', utils.defaultController);

// Ping route for the API
router.get('/status', utils.pingController);

// Audit logs route
router.get('/audit-logs', utils.auditLogsController);

// Diagnostic route for the API
router.get('/diagnostics', operations.getAllOperations);
router.get('/diagnostics/queued', operations.getAllQueuedOperations);
router.get('/diagnostics/initialized', operations.getAllInitializedOperations);
router.get('/diagnostics/finalized', operations.getAllFinalizedOperations);

// If using endpoint for receiving reveal data (non-EVM chains without L2 contract)
if (process.env.USE_ENDPOINT === 'true') {
  // Use lazy initialization pattern - only create controller when handling requests

  // Endpoint for receiving reveal data
  router.post('/api/reveal', (req: Request, res: Response) => {
    const endpointController = new EndpointController(chainHandler);
    return endpointController.handleReveal(req, res);
  });

  // Endpoint for checking deposit status
  router.get('/api/deposit/:depositId', (req: Request, res: Response) => {
    const endpointController = new EndpointController(chainHandler);
    return endpointController.getDepositStatus(req, res);
  });
}

export default router;
