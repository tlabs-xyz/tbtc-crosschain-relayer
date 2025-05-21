export enum NodeEnv {
  DEVELOPMENT = 'development',
  TEST = 'test',
  PRODUCTION = 'production',
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  appName: string;
  appVersion: string;
  verboseApp: boolean;
  apiOnlyMode: boolean;
  enableCleanupCron: boolean;
  hostPort: number;
  appPort: number;
  corsEnabled: boolean;
  corsUrl: string;
  jsonPath?: string; // TODO: Deprecated, remove after migrating the old relayer
  cleanQueuedTimeHours: number;
  cleanFinalizedTimeHours: number;
  cleanBridgedTimeHours: number;
  databaseUrl: string;
}
