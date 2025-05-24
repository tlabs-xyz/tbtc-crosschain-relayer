import type { NETWORK } from "../config/schemas/common.schema";

export const DEFAULT_APP_NAME = 'tBTC Cross-Chain Relayer';

export const ENV_NETWORK = process.env.NETWORK as NETWORK;
