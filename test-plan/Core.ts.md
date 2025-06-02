# Test Plan: `Core.ts` (Optimized Orchestration Testing)

## 🚨 **IMPLEMENTATION STATUS: CRITICAL GAP**

**Current Status:** ❌ **NO TESTS IMPLEMENTED** - This is a **HIGH PRIORITY** blocker  
**Risk Level:** 🔴 **CRITICAL** - Core orchestration logic completely untested  
**Required Action:** Implement ~20 integration tests immediately  
**Dependencies:** Blocks comprehensive system coverage

---

## 📋 **Analysis Summary (Updated)**

**Plan Quality:** ✅ Excellent optimization strategy  
**Coverage Strategy:** ✅ Smart "Mock Heavy, Test Light" approach  
**Implementation Gap:** 🔴 Complete - this is the most critical missing piece  
**Cross-Plan Dependencies:** Core.ts orchestrates components tested in other plans

**Why This Is Critical:**

- Core.ts is the orchestration layer that coordinates all other services
- Without these tests, cron job setup, multi-chain initialization, and error handling are untested
- Other component tests assume orchestration works correctly

---

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows (positive/negative cases) via external interfaces. Highest priority. Use real dependencies where feasible for max confidence.
- **Integration Tests:** Verify interactions between components/services. Mock external systems (blockchains, 3rd party APIs) and sometimes internal services to isolate interaction points. Cover specific scenarios within user flows.
- **Unit Tests:** Test isolated, non-trivial logic within a single function/module. Mock all dependencies. Used for complex logic not adequately covered by higher-level tests. Avoid redundancy.

---

## `Core.ts` - Actual Implementation Analysis

`Core.ts` is an **orchestration service** that coordinates multi-chain operations through cron jobs and initialization functions.

**Key Functions:**

- `startCronJobs()` - Sets up 4 cron schedules for deposit processing, redemptions, past deposits, and cleanup
- `initializeAllChains()` - Initializes chain handler registry and sets up listeners with concurrency control
- `initializeAllL2RedemptionServices()` - Initializes L2 redemption services for EVM chains
- `getL2RedemptionService()` - Utility function to retrieve L2 services

**🎯 Optimized Testing Strategy:**

- **Integration Tests:** ✅ **FOCUS HERE** - Mock all dependencies, test only orchestration logic
- **Unit Tests:** ✅ **MINIMAL** - Only test pure logic (configuration processing)
- **E2E Tests:** ❌ **SKIP** - Orchestration covered by integration tests + existing component E2E tests

**Key Optimization:** Mock all heavy business logic (already tested in component tests) and focus only on coordination, error handling, and configuration processing.

---

## Integration Tests (Primary Focus - ~15 Tests Total)

Mock all major dependencies: `CleanupDeposits`, `ChainHandlerRegistry`, `L2RedemptionService`, and individual chain handlers.

### **Function: `startCronJobs()`**

**Core Logic:** Set up 4 cron schedules with proper error handling and conditional cleanup jobs

**Mock Setup:**

```typescript
jest.mock('../services/CleanupDeposits.js', () => ({
  cleanQueuedDeposits: jest.fn(),
  cleanFinalizedDeposits: jest.fn(),
  cleanBridgedDeposits: jest.fn(),
}));

jest.mock('../handlers/ChainHandlerRegistry.js', () => ({
  chainHandlerRegistry: {
    list: jest.fn(() => [mockHandler1, mockHandler2]),
  },
}));
```

- **Test (Deposit Processing Cron - Every Minute):**

  ```typescript
  // Mock chainHandlerRegistry.list() to return 2 handlers
  // Mock each handler's processWormholeBridging, processFinalizeDeposits, processInitializeDeposits
  // Trigger cron job manually (using jest.advanceTimersByTime)
  // Verify: All handlers called in parallel, proper error handling per chain
  ```

- **Test (Redemption Processing Cron - Every 2 Minutes):**

  ```typescript
  // Mock L2RedemptionService instances in the map
  // Verify: processPendingRedemptions and processVaaFetchedRedemptions called
  // Test: Missing L2 service for a chain (should log error and continue)
  ```

- **Test (Past Deposits Cron - Every 60 Minutes):**

  ```typescript
  // Mock handler.supportsPastDepositCheck() to return true/false for different handlers
  // Mock handler.getLatestBlock() with valid/invalid values
  // Verify: checkForPastDeposits called only for supporting handlers with valid blocks
  ```

- **Test (Cleanup Cron - Conditional on ENABLE_CLEANUP_CRON):**

  ```typescript
  // Test with process.env.ENABLE_CLEANUP_CRON = 'true'
  // Verify: All three cleanup functions called in sequence
  // Test with ENABLE_CLEANUP_CRON = 'false' or undefined
  // Verify: Cleanup cron not scheduled
  ```

- **Test (Error Handling - Individual Chain Failures):**

  ```typescript
  // Mock one chain handler to throw error during deposit processing
  // Verify: Error logged with chain name, other chains continue processing
  // Verify: logErrorContext called with proper context
  ```

- **Test (Error Handling - Cleanup Function Failures):**
  ```typescript
  // Mock cleanQueuedDeposits to throw error
  // Verify: Error logged, other cleanup functions not affected
  ```

### **Function: `initializeAllChains()`**

**Core Logic:** Process SUPPORTED_CHAINS config, initialize registry, and set up handlers with concurrency control

- **Test (SUPPORTED_CHAINS Environment Variable Processing):**

  ```typescript
  // Set process.env.SUPPORTED_CHAINS = 'ethereum,polygon,invalid-chain'
  // Mock chainConfigs object with ethereum and polygon configs
  // Verify: Only valid chains added to effectiveChainConfigs
  // Verify: Warning logged for invalid-chain
  ```

- **Test (Empty SUPPORTED_CHAINS Handling):**

  ```typescript
  // Test with SUPPORTED_CHAINS = '' (empty string)
  // Verify: All loaded chain configs used (fallback behavior)
  // Verify: Appropriate warning logged
  ```

- **Test (No Valid Chains After Filtering):**

  ```typescript
  // Set SUPPORTED_CHAINS to only invalid chain names
  // Verify: Error logged about no valid configurations
  // Verify: Function continues without exiting (for test/API-only modes)
  ```

- **Test (Chain Handler Initialization with Concurrency):**

  ```typescript
  // Mock chainHandlerRegistry.initialize() and handler.initialize()
  // Mock multiple handlers in registry.list()
  // Verify: p-limit concurrency (max 5) respected
  // Verify: initialize() and setupListeners() called for each handler
  ```

- **Test (Individual Handler Initialization Failures):**
  ```typescript
  // Mock one handler.initialize() to throw error
  // Mock one handler.setupListeners() to throw error
  // Verify: Errors logged with chain names, other handlers continue
  // Verify: Function completes successfully despite individual failures
  ```

### **Function: `initializeAllL2RedemptionServices()`**

**Core Logic:** Filter EVM chains, create L2RedemptionService instances for enabled chains

- **Test (EVM Chain Filtering):**

  ```typescript
  // Mock chainConfigsArray with EVM and non-EVM chains
  // Verify: Only EVM chains processed
  // Verify: Appropriate warning if no EVM chains found
  ```

- **Test (L2 Redemption Enabled/Disabled):**

  ```typescript
  // Mock EVM chains with enableL2Redemption: true/false
  // Verify: Services created only for enabled chains
  // Verify: Appropriate info logs for disabled chains
  ```

- **Test (L2RedemptionService Creation Failures):**

  ```typescript
  // Mock L2RedemptionService.create() to throw error for one chain
  // Verify: Error logged, other chains continue initialization
  // Verify: Service not added to map for failed chain
  ```

- **Test (Duplicate Service Prevention):**
  ```typescript
  // Call function twice for same chain
  // Verify: Service created only once, debug log for already initialized
  ```

---

## Unit Tests (Minimal Focus - ~5 Tests Total)

Test only pure logic that doesn't require complex mocking.

### **Function: `getL2RedemptionService()`**

- **Test (Service Retrieval):**
  ```typescript
  // Manually populate l2RedemptionServices map
  // Verify: Correct service returned for existing chain
  // Verify: undefined returned for non-existent chain
  ```

### **Configuration Processing Logic**

- **Test (Chain Config Array Filtering):**
  ```typescript
  // Test filtering logic for null/undefined configs
  // Test effectiveChainConfigs assignment logic
  ```

---

## **Cross-Plan Dependencies & Validation**

This optimized plan **leverages existing comprehensive test coverage**:

✅ **CleanupDeposits tests** (`tests/integration/services/CleanupDeposits.test.ts` - 550 lines)
**Status:** ✅ FULLY IMPLEMENTED

- Covers all cleanup business logic, time calculations, environment variables
- Referenced in Core.ts cron jobs but business logic not re-tested

✅ **CleanupDeposits E2E tests** (`tests/e2e/CleanupDeposits.e2e.test.ts` - 484 lines)
**Status:** ✅ FULLY IMPLEMENTED

- Covers end-to-end cleanup flows
- Validates cleanup functionality works in real scenarios

✅ **L2RedemptionService tests** (Multiple files - Unit, Integration, E2E)
**Status:** ✅ FULLY IMPLEMENTED

- Core.ts orchestrates L2 services, business logic tested separately
- Excellent separation of concerns achieved

⚠️ **Chain Handler tests** (assumed to exist in separate files)
**Status:** 🔍 REQUIRES VALIDATION

- Cover deposit processing logic called by Core.ts cron jobs
- Core.ts tests only verify handlers are called, not their internal logic
- **Action Required:** Verify chain handler test coverage exists

---

## **Implementation Priority (Updated)**

### **IMMEDIATE (Critical):**

1. **🔴 Core.ts Integration Tests** - Blocking system coverage
   - **Target:** ~15 integration tests
   - **Focus:** Cron jobs, chain initialization, error handling
   - **Timeline:** Implement first to unblock system confidence

### **VALIDATION REQUIRED:**

2. **🔍 Chain Handler Coverage** - Verify existing coverage
   - **Action:** Audit existing chain handler tests
   - **Risk:** If missing, add to high priority list

### **FUTURE ENHANCEMENTS:**

3. **📈 Performance Testing** - Not currently covered
   - **Scope:** Cron job performance under load
   - **Priority:** Lower, implement after core coverage complete

**Success Criteria:**

- [ ] All cron jobs tested with mocked dependencies
- [ ] Chain initialization error handling validated
- [ ] L2 service orchestration tested
- [ ] Environment variable configuration tested
- [ ] Concurrency control validated

This approach provides **full confidence with minimal redundancy** by strategically layering tests and avoiding duplicate coverage of well-tested components.
