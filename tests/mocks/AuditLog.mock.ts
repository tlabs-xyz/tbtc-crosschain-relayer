/**
 * Shared AuditLog mock for consistent mocking across test files
 * This helps prevent Jest module caching issues
 */
export const createAuditLogMock = () => ({
  AuditEventType: {
    DEPOSIT_CREATED: 'DEPOSIT_CREATED',
    DEPOSIT_UPDATED: 'DEPOSIT_UPDATED',
    STATUS_CHANGED: 'STATUS_CHANGED',
    DEPOSIT_INITIALIZED: 'DEPOSIT_INITIALIZED',
    DEPOSIT_FINALIZED: 'DEPOSIT_FINALIZED',
    DEPOSIT_DELETED: 'DEPOSIT_DELETED',
    DEPOSIT_AWAITING_WORMHOLE_VAA: 'DEPOSIT_AWAITING_WORMHOLE_VAA',
    DEPOSIT_BRIDGED: 'DEPOSIT_BRIDGED',
    ERROR: 'ERROR',
    API_REQUEST: 'API_REQUEST',
  },
  appendToAuditLog: jest.fn().mockResolvedValue(undefined),
  getAuditLogs: jest.fn().mockResolvedValue([]),
  getAuditLogsByDepositId: jest.fn().mockResolvedValue([]),
  logDepositCreated: jest.fn().mockResolvedValue(undefined),
  logStatusChange: jest.fn().mockResolvedValue(undefined),
  logDepositInitialized: jest.fn().mockResolvedValue(undefined),
  logDepositFinalized: jest.fn().mockResolvedValue(undefined),
  logDepositDeleted: jest.fn().mockResolvedValue(undefined),
  logApiRequest: jest.fn().mockResolvedValue(undefined),
  logDepositError: jest.fn().mockResolvedValue(undefined),
  logDepositAwaitingWormholeVAA: jest.fn().mockReturnValue(undefined),
  logDepositBridged: jest.fn().mockReturnValue(undefined),
});
