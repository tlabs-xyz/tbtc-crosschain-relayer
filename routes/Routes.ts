import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import escapeHtml from 'escape-html';

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

    if (options.allowAllKeyword && chainName === 'all') {
      expressReq.chainHandler = undefined; // Special case for 'all'
      return next();
    }

    expressReq.chainName = chainName;
    const handler = chainHandlerRegistry.get(chainName);

    if (!handler) {
      return res.status(404).send(`Unknown chain: ${escapeHtml(chainName)}`);
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

class RoutesSingleton {
  public router: Router;
  private static instance: RoutesSingleton;

  private constructor() {
    console.log('[[[[[ RoutesSingleton CONSTRUCTOR ]]]]] CREATING ROUTER');
    this.router = Router();
    this.initializeRoutes();
  }

  public static getInstance(): RoutesSingleton {
    if (!RoutesSingleton.instance) {
      RoutesSingleton.instance = new RoutesSingleton();
    }
    return RoutesSingleton.instance;
  }

  private initializeRoutes(): void {
    console.log('[[[[[ RoutesSingleton INITIALIZING ROUTES ]]]]] Initializing routes...');
    const utils = new Utils();
    const operations = new Operations();
    const validateChainAndGetHandler = createChainValidator({ allowAllKeyword: true });

    // Mount the chain-specific router under /api/:chainName, AFTER validation middleware
    this.router.use('/api/:chainName', validateChainAndGetHandler, chainSpecificRouter);
    console.log(
      '[[[[[ RoutesSingleton MOUNTED ]]]]] MOUNTED /api/:chainName with chainSpecificRouter',
    );

    this.router.get('/', utils.defaultController);
    this.router.get('/status', utils.pingController);

    // Audit logs route for a specific chain
    this.router.get(
      '/api/:chainName/audit-logs',
      validateChainAllowAll,
      (req: Request, res: Response) => {
        const { chainName } = req as RequestWithChainInfo;
        // The controller expects chainName as a third argument.
        return utils.auditLogsController(req, res, chainName!);
      },
    );

    // Diagnostic routes for a specific chain
    this.router.get(
      '/api/:chainName/diagnostics',
      validateChainAllowAll,
      (req: Request, res: Response) => {
        const { chainName } = req as RequestWithChainInfo;
        return operations.getAllOperations(req, res, chainName!);
      },
    );

    this.router.get(
      '/api/:chainName/diagnostics/queued',
      validateChainAllowAll,
      (req: Request, res: Response) => {
        const { chainName } = req as RequestWithChainInfo;
        return operations.getAllQueuedOperations(req, res, chainName!);
      },
    );

    this.router.get(
      '/api/:chainName/diagnostics/initialized',
      validateChainAllowAll,
      (req: Request, res: Response) => {
        const { chainName } = req as RequestWithChainInfo;
        return operations.getAllInitializedOperations(req, res, chainName!);
      },
    );

    this.router.get(
      '/api/:chainName/diagnostics/finalized',
      validateChainAllowAll,
      (req: Request, res: Response) => {
        const { chainName } = req as RequestWithChainInfo;
        return operations.getAllFinalizedOperations(req, res, chainName!);
      },
    );

    // Multi-chain endpoint routes (require chainName as path param)
    if (process.env.USE_ENDPOINT === 'true') {
      // Endpoint for receiving reveal data
      this.router.post(
        '/api/:chainName/reveal',
        validateChainStrict,
        (req: Request, res: Response) => {
          const { chainHandler, chainName } = req as RequestWithChainInfo;
          const chainConfig = chainHandler?.config;

          if (!chainConfig?.supportsRevealDepositAPI) {
            logger.warn(
              `Reveal deposit API called for chain ${chainName}, but it's not supported/enabled in config.`,
            );
            return res.status(405).json({
              success: false,
              error: `Reveal deposit API is not supported or enabled for chain: ${chainName}`,
            });
          }
          const endpointController = new EndpointController(chainHandler!);
          return endpointController.handleReveal(req, res);
        },
      );

      // Endpoint for checking deposit status
      this.router.get(
        '/api/:chainName/deposit/:depositId',
        validateChainStrict,
        (req: Request, res: Response) => {
          const { chainHandler } = req as RequestWithChainInfo;
          const endpointController = new EndpointController(chainHandler!);
          return endpointController.getDepositStatus(req, res);
        },
      );
    }

    console.log('[[[[[ RoutesSingleton ALL ROUTES INITIALIZED ]]]]] All routes initialized.');
  }
}

export const mainRoutes = RoutesSingleton.getInstance();
export const router = mainRoutes.router;

// Controllers - These are now instantiated within initializeRoutes or used by chainSpecificRouter
// const utils = new Utils(); // No longer needed here
// const operations = new Operations(); // No longer needed here

// Default route for the API - Handled in initializeRoutes
// router.get('/', utils.defaultController);

// Ping route for the API - Handled in initializeRoutes
// router.get('/status', utils.pingController);

// Audit logs route for a specific chain - Handled in initializeRoutes
// router.get('/api/:chainName/audit-logs', validateChainAllowAll, (req: Request, res: Response) => {
//   const { chainName } = req as RequestWithChainInfo;
//   // The controller expects chainName as a third argument.
//   return utils.auditLogsController(req, res, chainName!);
// });

// Diagnostic routes for a specific chain - Handled in initializeRoutes
// router.get('/api/:chainName/diagnostics', validateChainAllowAll, (req: Request, res: Response) => {
//   const { chainName } = req as RequestWithChainInfo;
//   return operations.getAllOperations(req, res, chainName!);
// });

// router.get(
//   '/api/:chainName/diagnostics/queued',
//   validateChainAllowAll,
//   (req: Request, res: Response) => {
//     const { chainName } = req as RequestWithChainInfo;
//     return operations.getAllQueuedOperations(req, res, chainName!);
//   },
// );

// router.get(
//   '/api/:chainName/diagnostics/initialized',
//   validateChainAllowAll,
//   (req: Request, res: Response) => {
//     const { chainName } = req as RequestWithChainInfo;
//     return operations.getAllInitializedOperations(req, res, chainName!);
//   },
// );

// router.get(
//   '/api/:chainName/diagnostics/finalized',
//   validateChainAllowAll,
//   (req: Request, res: Response) => {
//     const { chainName } = req as RequestWithChainInfo;
//     return operations.getAllFinalizedOperations(req, res, chainName!);
//   },
// );

// Multi-chain endpoint routes (require chainName as path param) - Handled in initializeRoutes
// if (process.env.USE_ENDPOINT === 'true') {
//   // Endpoint for receiving reveal data
//   router.post('/api/:chainName/reveal', validateChainStrict, (req: Request, res: Response) => {
//     const { chainHandler, chainName } = req as RequestWithChainInfo;
//     const chainConfig = chainHandler?.config;

//     if (!chainConfig?.supportsRevealDepositAPI) {
//       logger.warn(
//         `Reveal deposit API called for chain ${chainConfig}, but it's not supported/enabled in config.`,
//       );
//       return res.status(405).json({
//         success: false,
//         error: `Reveal deposit API is not supported or enabled for chain: ${chainName}`,
//       });
//     }
//     const endpointController = new EndpointController(chainHandler!);
//     return endpointController.handleReveal(req, res);
//   });

//   // Endpoint for checking deposit status
//   router.get(
//     '/api/:chainName/deposit/:depositId',
//     validateChainStrict,
//     (req: Request, res: Response) => {
//       const { chainHandler } = req as RequestWithChainInfo;
//       const endpointController = new EndpointController(chainHandler!);
//       return endpointController.getDepositStatus(req, res);
//     },
//   );
// }

export default router;
