import express from 'express';
import type { Request, Response } from 'express';

import Operations from '../controllers/Operations.controller.js';
import Utils from '../controllers/Utils.controller.js';
import { EndpointController } from '../controllers/Endpoint.controller.js';
import { chainHandlerRegistry } from '../handlers/ChainHandlerRegistry.js';

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

// Multi-chain endpoint routes (require chainName as path param)
if (process.env.USE_ENDPOINT === 'true') {
  // Endpoint for receiving reveal data
  router.post('/api/:chainName/reveal', (req: Request, res: Response) => {
    const { chainName } = req.params;
    const handler = chainHandlerRegistry.get(chainName);
    if (!handler) {
      return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
    }
    const endpointController = new EndpointController(handler);
    return endpointController.handleReveal(req, res);
  });

  // Endpoint for checking deposit status
  router.get('/api/:chainName/deposit/:depositId', (req: Request, res: Response) => {
    const { chainName } = req.params;
    const handler = chainHandlerRegistry.get(chainName);
    if (!handler) {
      return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
    }
    const endpointController = new EndpointController(handler);
    return endpointController.getDepositStatus(req, res);
  });
}

export default router;
