import express from "express";

import Operations from "../controllers/Operations.controller";
import Utils from "../controllers/Utils.controller";
import { EndpointController } from "../controllers/Endpoint.controller";
import { chainHandler } from "../services/Core";

export const router = express.Router();

// Controllers
const utils = new Utils();
const operations = new Operations();

// Default route for the API
router.get("/", utils.defaultController);

// Ping route for the API
router.get("/status", utils.pingController);

// Diagnostic route for the API
router.get("/diagnostics", operations.getAllOperations);
router.get("/diagnostics/queued", operations.getAllQueuedOperations);
router.get("/diagnostics/initialized", operations.getAllInitializedOperations);
router.get("/diagnostics/finalized", operations.getAllFinalizedOperations);

// If using endpoint for receiving reveal data (non-EVM chains without L2 contract)
if (process.env.USE_ENDPOINT === "true") {
  const endpointController = new EndpointController(chainHandler);
  
  // Endpoint for receiving reveal data
  router.post("/api/reveal", endpointController.handleReveal.bind(endpointController));
  
  // Endpoint for checking deposit status
  router.get("/api/deposit/:depositId", endpointController.getDepositStatus.bind(endpointController));
}

export default router;