/**
 * Test Environment Setup
 * Handles test database, services, and parallel test execution
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';

/**
 * Test database configuration
 */
export interface TestDatabaseConfig {
  /** Use in-memory SQLite database */
  useInMemory?: boolean;
  /** Database URL override */
  databaseUrl?: string;
  /** Whether to run migrations */
  runMigrations?: boolean;
  /** Whether to seed data */
  seedData?: boolean;
}

/**
 * Test services configuration
 */
export interface TestServicesConfig {
  /** Whether to start mock HTTP server */
  mockHttpServer?: boolean;
  /** Port for mock HTTP server */
  mockHttpPort?: number;
  /** Whether to start mock WebSocket server */
  mockWsServer?: boolean;
  /** Port for mock WebSocket server */
  mockWsPort?: number;
}

/**
 * Complete test environment configuration
 */
export interface TestEnvConfig {
  /** Database configuration */
  database?: TestDatabaseConfig;
  /** Services configuration */
  services?: TestServicesConfig;
  /** Test timeout in milliseconds */
  timeout?: number;
  /** Whether to enable debug logging */
  debug?: boolean;
}

/**
 * Test database manager
 */
export class TestDatabaseManager {
  private prisma: PrismaClient | null = null;
  private databaseUrl: string;
  private originalDatabaseUrl: string | undefined;
  private testSchema?: string;

  constructor(private config: TestDatabaseConfig = {}) {
    this.originalDatabaseUrl = process.env.DATABASE_URL;
    this.databaseUrl = this.setupDatabaseUrl();
  }

  /**
   * Initialize the test database
   */
  async initialize(): Promise<PrismaClient> {
    // Set database URL
    process.env.DATABASE_URL = this.databaseUrl;

    // Create Prisma client
    this.prisma = new PrismaClient({
      log: process.env.DEBUG === 'true' ? ['query', 'info', 'warn', 'error'] : [],
      datasources: {
        db: {
          url: this.databaseUrl,
        },
      },
    });

    // Run migrations if requested
    if (this.config.runMigrations !== false) {
      await this.runMigrations();
    }

    // Connect to database
    await this.prisma.$connect();

    // Seed data if requested
    if (this.config.seedData) {
      await this.seedTestData();
    }

    return this.prisma;
  }

  /**
   * Clean up the test database
   */
  async cleanup(): Promise<void> {
    if (this.prisma) {
      // Clear all data
      await this.clearAllData();

      // Drop test schema if we created one
      if (this.testSchema) {
        try {
          await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${this.testSchema} CASCADE`);
        } catch (error) {
          // Ignore errors during cleanup
        }
      }

      // Disconnect
      await this.prisma.$disconnect();
      this.prisma = null;
    }

    // Restore original database URL
    if (this.originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = this.originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }

  /**
   * Clear all data from the database
   */
  async clearAllData(): Promise<void> {
    if (!this.prisma) return;

    // Delete in correct order to respect foreign keys
    await this.prisma.auditLog.deleteMany();
    await this.prisma.redemption.deleteMany();
    await this.prisma.deposit.deleteMany();
  }

  /**
   * Get the Prisma client instance
   */
  getClient(): PrismaClient {
    if (!this.prisma) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.prisma;
  }

  /**
   * Setup database URL based on configuration
   */
  private setupDatabaseUrl(): string {
    if (this.config.databaseUrl) {
      return this.config.databaseUrl;
    }

    // For testing, we'll use a PostgreSQL test database from environment
    // or fall back to a default test database URL
    const testDbUrl =
      process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/test_db';

    if (this.config.useInMemory) {
      // For in-memory, we'll create a unique schema in the test database
      const testId = randomBytes(4).toString('hex');
      this.testSchema = `test_${testId}`;
      return `${testDbUrl}?schema=${this.testSchema}`;
    }

    // Create a unique schema for this test run
    const testId = randomBytes(8).toString('hex');
    this.testSchema = `test_${testId}`;
    return `${testDbUrl}?schema=${this.testSchema}`;
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    try {
      // For test databases, always use db push to create schema
      execSync('npx prisma db push --skip-generate --accept-data-loss', {
        env: { ...process.env, DATABASE_URL: this.databaseUrl },
        stdio: 'pipe', // Suppress output unless there's an error
      });
    } catch (error) {
      console.error('Failed to run migrations:', error);
      throw error;
    }
  }

  /**
   * Seed test data
   */
  private async seedTestData(): Promise<void> {
    if (!this.prisma) return;

    // Add some test deposits
    await this.prisma.deposit.createMany({
      data: [
        {
          id: 'test-deposit-1',
          chainId: 'test-chain',
          fundingTxHash: '0x' + '1'.repeat(64),
          outputIndex: 0,
          owner: '0x' + '2'.repeat(40),
          status: 0, // QUEUED
          hashes: {
            btc: { btcTxHash: '0x' + '1'.repeat(64) },
            eth: { initializeTxHash: null, finalizeTxHash: null },
          },
          receipt: {
            depositor: '0x' + '2'.repeat(40),
            blindingFactor: '0x' + '0'.repeat(64),
            walletPublicKeyHash: '0x' + '0'.repeat(40),
            refundPublicKeyHash: '0x' + '0'.repeat(40),
            refundLocktime: '1800000000',
            extraData: '0x',
          },
          dates: {
            createdAt: new Date().toISOString(),
            initializationAt: null,
            finalizationAt: null,
            lastActivityAt: new Date().toISOString(),
          },
        },
        {
          id: 'test-deposit-2',
          chainId: 'test-chain',
          fundingTxHash: '0x' + '3'.repeat(64),
          outputIndex: 0,
          owner: '0x' + '4'.repeat(40),
          status: 1, // INITIALIZED
          hashes: {
            btc: { btcTxHash: '0x' + '3'.repeat(64) },
            eth: {
              initializeTxHash: '0x' + '5'.repeat(64),
              finalizeTxHash: null,
            },
          },
          receipt: {
            depositor: '0x' + '4'.repeat(40),
            blindingFactor: '0x' + '0'.repeat(64),
            walletPublicKeyHash: '0x' + '0'.repeat(40),
            refundPublicKeyHash: '0x' + '0'.repeat(40),
            refundLocktime: '1800000000',
            extraData: '0x',
          },
          dates: {
            createdAt: new Date().toISOString(),
            initializationAt: new Date().toISOString(),
            finalizationAt: null,
            lastActivityAt: new Date().toISOString(),
          },
        },
      ],
    });
  }
}

/**
 * Mock HTTP server for testing
 */
export class MockHttpServer {
  private server: any = null;
  private port: number;
  private handlers: Map<string, (req: any, res: any) => void> = new Map();

  constructor(port = 0) {
    this.port = port;
  }

  /**
   * Start the mock server
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        // Dynamic import to avoid loading http in non-test environments
        import('http').then((http) => {
          this.server = http.createServer((req, res) => {
            const handler = this.handlers.get(`${req.method} ${req.url}`);
            if (handler) {
              handler(req, res);
            } else {
              res.statusCode = 404;
              res.end('Not Found');
            }
          });

          this.server.listen(this.port, () => {
            this.port = this.server.address().port;
            resolve(this.port);
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Register a request handler
   */
  on(method: string, path: string, handler: (req: any, res: any) => void): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  /**
   * Get the server URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}

/**
 * Test environment manager
 */
export class TestEnvironmentManager {
  private database?: TestDatabaseManager;
  private httpServer?: MockHttpServer;
  private config: TestEnvConfig;

  constructor(config: TestEnvConfig = {}) {
    this.config = config;
  }

  /**
   * Setup the complete test environment
   */
  async setup(): Promise<{
    prisma?: PrismaClient;
    httpServer?: MockHttpServer;
    cleanup: () => Promise<void>;
  }> {
    const result: any = {};

    // Setup database
    if (this.config.database) {
      this.database = new TestDatabaseManager(this.config.database);
      result.prisma = await this.database.initialize();
    }

    // Setup HTTP server
    if (this.config.services?.mockHttpServer) {
      this.httpServer = new MockHttpServer(this.config.services.mockHttpPort);
      await this.httpServer.start();
      result.httpServer = this.httpServer;
    }

    // Setup cleanup function
    result.cleanup = async () => {
      await this.cleanup();
    };

    return result;
  }

  /**
   * Clean up all test resources
   */
  async cleanup(): Promise<void> {
    // Stop services
    if (this.httpServer) {
      await this.httpServer.stop();
    }

    // Clean up database
    if (this.database) {
      await this.database.cleanup();
    }
  }
}

/**
 * Create a test environment for a specific test suite
 */
export function createTestEnvironment(config?: TestEnvConfig): TestEnvironmentManager {
  return new TestEnvironmentManager(config);
}

/**
 * Setup test environment for parallel execution
 */
export function setupParallelTestEnvironment(): TestEnvConfig {
  const workerId = process.env.JEST_WORKER_ID || '1';
  const basePort = 3000;
  const portOffset = parseInt(workerId) * 10;

  return {
    database: {
      useInMemory: false, // Use separate SQLite files for parallel tests
      runMigrations: true,
    },
    services: {
      mockHttpServer: true,
      mockHttpPort: basePort + portOffset,
      mockWsServer: false,
    },
    debug: process.env.DEBUG === 'true',
  };
}

/**
 * Jest global setup helper
 */
export async function globalTestSetup(): Promise<void> {
  // Set test environment
  process.env.NODE_ENV = 'test';

  // Disable console logs unless debugging
  if (process.env.DEBUG !== 'true') {
    global.console.log = jest.fn();
    global.console.info = jest.fn();
    global.console.warn = jest.fn();
  }
}

/**
 * Jest global teardown helper
 */
export async function globalTestTeardown(): Promise<void> {
  // For PostgreSQL, schemas are cleaned up automatically when the connection closes
  // No file cleanup needed
}
