import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';

import Operations from '../controllers/Operations.controller';
import Utils from '../controllers/Utils.controller';
import { EndpointController } from '../controllers/Endpoint.controller';
import { chainHandlerRegistry } from '../handlers/ChainHandlerRegistry';
import type { ChainHandlerInterface } from '../interfaces/ChainHandler.interface';
import logger from '../utils/Logger';
import type { AnyChainConfig } from '../config/index';

// Custom Request Interface
export interface RequestWithChainInfo extends Request {
  chainName?: string;
  chainHandler?: ChainHandlerInterface;
  chainConfig?: AnyChainConfig;
}

// Middleware factory for chain validation
interface ChainValidationOptions {
  allowAllKeyword?: boolean;
}

// Helper function to create the chain validation middleware
const createChainValidator = (options: ChainValidationOptions = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const expressReq = req as RequestWithChainInfo;
    const { chainName } = req.params as { chainName: string };

    expressReq.chainName = chainName;
    const handler = chainHandlerRegistry.get(chainName);

    if (!handler) {
      return res.status(404).send(`Unknown chain: ${chainName}`);
    }

    expressReq.chainHandler = handler;
    expressReq.chainConfig = handler.config;
    next();
  };
};

// Define the chainSpecificRouter that handles endpoints after :chainName is validated
const chainSpecificRouter = Router({ mergeParams: true }); // mergeParams is important for nested routers

// Define the validation middlewares
const validateChainStrict = createChainValidator();
const validateChainAllowAll = createChainValidator({ allowAllKeyword: true });

chainSpecificRouter.post('/reveal', (req: Request, res: Response) => {
  const { chainHandler } = req as RequestWithChainInfo;
  const endpointController = new EndpointController(chainHandler!);
  return endpointController.handleReveal(req, res);
});
chainSpecificRouter.get('/deposit/:depositId', (req: Request, res: Response) => {
  const { chainHandler } = req as RequestWithChainInfo;
  const endpointController = new EndpointController(chainHandler!);
  return endpointController.getDepositStatus(req, res);
});
// Add other chain-specific routes here if any

let routerInstanceIdCounter = 0;

class RoutesSingleton {
  public router: Router;
  private readonly instanceId: number;
  private static instance: RoutesSingleton;

  private constructor() {
    this.instanceId = ++routerInstanceIdCounter;
    console.log(
      `[[[[[ RoutesSingleton CONSTRUCTOR - Instance ${this.instanceId} ]]]]] CREATING ROUTER`,
    );
    this.router = Router();
    this.initializeRoutes();
  }

  public static getInstance(): RoutesSingleton {
    if (!RoutesSingleton.instance) {
      RoutesSingleton.instance = new RoutesSingleton();
    }
    return RoutesSingleton.instance;
  }

  public getInstanceId(): number {
    return this.instanceId;
  }

  private initializeRoutes(): void {
    console.log(
      `[[[[[ RoutesSingleton CONSTRUCTOR - Instance ${this.instanceId} ]]]]] Initializing routes...`,
    );
    const utils = new Utils(); // Instantiated Utils here for clarity for these routes
    const validateChainAndGetHandler = createChainValidator({ allowAllKeyword: true });

    // Mount the chain-specific router under /api/:chainName, AFTER validation middleware
    this.router.use('/api/:chainName', validateChainAndGetHandler, chainSpecificRouter);
    console.log(
      `[[[[[ RoutesSingleton CONSTRUCTOR - Instance ${this.instanceId} ]]]]] MOUNTED /api/:chainName with chainSpecificRouter`,
    );

    this.router.get('/', utils.defaultController); // Corrected to use utils.defaultController
    this.router.get('/status', utils.pingController); // Corrected to use utils.pingController
    console.log(
      `[[[[[ RoutesSingleton CONSTRUCTOR - Instance ${this.instanceId} ]]]]] All routes initialized.`,
    );
  }
}

export const mainRoutes = RoutesSingleton.getInstance();
export const router = mainRoutes.router;

// Controllers
const utils = new Utils();
const operations = new Operations();

// Default route for the API
router.get('/', utils.defaultController);

// Ping route for the API
router.get('/status', utils.pingController);

// Audit logs route for a specific chain
router.get('/api/:chainName/audit-logs', validateChainAllowAll, (req: Request, res: Response) => {
  const { chainName } = req as RequestWithChainInfo;
  // The controller expects chainName as a third argument.
  return utils.auditLogsController(req, res, chainName!); // Added non-null assertion
});

// Diagnostic routes for a specific chain
router.get('/api/:chainName/diagnostics', validateChainAllowAll, (req: Request, res: Response) => {
  const { chainName } = req as RequestWithChainInfo;
  return operations.getAllOperations(req, res, chainName!); // Added non-null assertion
});

router.get(
  '/api/:chainName/diagnostics/queued',
  validateChainAllowAll,
  (req: Request, res: Response) => {
    const { chainName } = req as RequestWithChainInfo;
    return operations.getAllQueuedOperations(req, res, chainName!); // Added non-null assertion
  },
);

router.get(
  '/api/:chainName/diagnostics/initialized',
  validateChainAllowAll,
  (req: Request, res: Response) => {
    const { chainName } = req as RequestWithChainInfo;
    return operations.getAllInitializedOperations(req, res, chainName!); // Added non-null assertion
  },
);

router.get(
  '/api/:chainName/diagnostics/finalized',
  validateChainAllowAll,
  (req: Request, res: Response) => {
    const { chainName } = req as RequestWithChainInfo;
    return operations.getAllFinalizedOperations(req, res, chainName!); // Added non-null assertion
  },
);

// Multi-chain endpoint routes (require chainName as path param)
if (process.env.USE_ENDPOINT === 'true') {
  // Endpoint for receiving reveal data
  router.post('/api/:chainName/reveal', validateChainStrict, (req: Request, res: Response) => {
    const { chainHandler, chainName } = req as RequestWithChainInfo;
    const chainConfig = chainHandler?.config;

    if (!chainConfig?.supportsRevealDepositAPI) {
      logger.warn(
        `Reveal deposit API called for chain ${chainConfig}, but it's not supported/enabled in config.`,
      );
      return res.status(405).json({
        success: false,
        error: `Reveal deposit API is not supported or enabled for chain: ${chainName}`,
      });
    }
    const endpointController = new EndpointController(chainHandler!);
    return endpointController.handleReveal(req, res);
  });

  // Endpoint for checking deposit status
  router.get(
    '/api/:chainName/deposit/:depositId',
    validateChainStrict,
    (req: Request, res: Response) => {
      const { chainHandler } = req as RequestWithChainInfo;
      const endpointController = new EndpointController(chainHandler!);
      return endpointController.getDepositStatus(req, res);
    },
  );
}

export default router;
