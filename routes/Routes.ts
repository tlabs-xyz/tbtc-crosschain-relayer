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

// Audit logs route for a specific chain
router.get('/api/:chainName/audit-logs', (req: Request, res: Response) => {
  const { chainName } = req.params;
  // We might not need a full handler here if the controller just needs the chainName for DB queries.
  // However, for consistency and future use where a handler might be needed, we can check its existence.
  const handler = chainHandlerRegistry.get(chainName);
  if (!handler && chainName !== 'all') { // Allow 'all' as a special keyword if desired later, or enforce valid handler
    return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
  }
  // Pass chainName to the controller method
  return utils.auditLogsController(req, res, chainName);
});

// Diagnostic routes for a specific chain
router.get('/api/:chainName/diagnostics', (req: Request, res: Response) => {
  const { chainName } = req.params;
  const handler = chainHandlerRegistry.get(chainName);
  if (!handler && chainName !== 'all') {
    return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
  }
  return operations.getAllOperations(req, res, chainName);
});

router.get('/api/:chainName/diagnostics/queued', (req: Request, res: Response) => {
  const { chainName } = req.params;
  const handler = chainHandlerRegistry.get(chainName);
  if (!handler && chainName !== 'all') {
    return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
  }
  return operations.getAllQueuedOperations(req, res, chainName);
});

router.get('/api/:chainName/diagnostics/initialized', (req: Request, res: Response) => {
  const { chainName } = req.params;
  const handler = chainHandlerRegistry.get(chainName);
  if (!handler && chainName !== 'all') {
    return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
  }
  return operations.getAllInitializedOperations(req, res, chainName);
});

router.get('/api/:chainName/diagnostics/finalized', (req: Request, res: Response) => {
  const { chainName } = req.params;
  const handler = chainHandlerRegistry.get(chainName);
  if (!handler && chainName !== 'all') {
    return res.status(404).json({ success: false, error: `Unknown chain: ${chainName}` });
  }
  return operations.getAllFinalizedOperations(req, res, chainName);
});

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
