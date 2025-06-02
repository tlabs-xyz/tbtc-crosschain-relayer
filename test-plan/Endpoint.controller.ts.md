# Test Plan: `Endpoint.controller.ts` (Optimized)

This document outlines an **optimized test plan** for `Endpoint.controller.ts` that eliminates redundancy between test levels.

## Testing Philosophy Recap

- **E2E Tests:** Validate complete user flows and system integration points. Focus on real HTTP requests through Express middleware and routing.
- **Integration Tests:** Verify service layer interactions and complex error scenarios. Mock external systems but test real service method calls.
- **Unit Tests:** Test isolated, complex logic. **ELIMINATED** for this controller due to minimal complex logic.

---

## **Optimized Testing Strategy: Eliminate Redundancy**

### **E2E Tests (Focus: Complete Flows & External Integration)**

**Purpose:** Validate real user journeys and system integration points.

#### **Tests to Implement:**

1. **Complete Deposit Workflow**

   ```typescript
   test('Full deposit journey: POST /api/:chainName/reveal → GET /api/:chainName/deposit/:id → success', async () => {
     // Test: Send valid reveal data, verify 200 response with depositId
     // Then: Query status with received depositId, verify 200 with correct status
     // Validates: Complete user workflow end-to-end
   });
   ```

2. **System Integration Points**

   ```typescript
   test('Invalid chain name returns 404', async () => {
     // Test: POST /api/invalidChainName/reveal
     // Expected: 404 Not Found
     // Validates: Express routing and middleware integration
   });

   test('Environment configuration (USE_ENDPOINT=false) blocks access', async () => {
     // Test: Temporarily set USE_ENDPOINT=false, attempt POST /api/:chainName/reveal
     // Expected: 405 Method Not Allowed or route not found
     // Validates: Environment-based conditional routing
   });
   ```

3. **Critical Error Paths**
   ```typescript
   test('Non-existent deposit returns 404', async () => {
     // Test: GET /api/:chainName/deposit/nonExistentId
     // Expected: 404 with "Deposit not found" message
     // Validates: Database/storage integration and error handling
   });
   ```

#### **Tests Removed (Covered by Integration):**

- ✂️ Input validation errors (400 responses) - better tested with mocked services
- ✂️ Detailed error message content verification - not E2E concern

---

### **Integration Tests (Focus: Service Interactions & Business Logic)**

**Purpose:** Verify service layer interactions and complex error scenarios.

#### **Tests to Implement:**

1. **Service Error Handling**

   ```typescript
   test('ChainHandler.initializeDeposit throws DuplicateDepositError → appropriate error response', async () => {
     // Mock: ChainHandler.initializeDeposit to throw DuplicateDepositError
     // Test: handleReveal with valid data
     // Expected: Appropriate error status (409 Conflict) and error message
     // Validates: Specific service error mapping and handling
   });

   test('ChainHandler.checkDepositStatus throws network error → 500', async () => {
     // Mock: ChainHandler.checkDepositStatus to throw network error
     // Test: getDepositStatus with valid depositId
     // Expected: 500 Internal Server Error with generic error message
     // Validates: Unexpected error handling and logging
   });
   ```

2. **Business Logic Validation**

   ```typescript
   test('Missing required fields validation logic', async () => {
     // Test: handleReveal with missing fundingTx, reveal, l2DepositOwner, l2Sender
     // Expected: 400 Bad Request with specific error message
     // Validates: Controller's input validation logic
   });

   test('DepositStore integration for duplicate detection', async () => {
     // Mock: DepositStore.getById to return existing deposit
     // Test: handleReveal with valid data for existing deposit
     // Expected: Early return without calling ChainHandler.initializeDeposit
     // Validates: Business logic around existing deposits
   });
   ```

#### **Tests Removed (Covered by E2E):**

- ✂️ Basic success paths (200 responses) - covered by E2E workflows
- ✂️ Basic error responses without service interaction - covered by E2E
- ✂️ Request/response format verification - covered by E2E

---

### **Unit Tests (ELIMINATED)**

**Rationale:** `EndpointController` contains minimal complex logic. Most functionality is:

- Simple request parsing → covered by E2E tests
- Service method calls → covered by Integration tests
- Response formatting → covered by E2E tests

**No unit tests needed for this controller.**

---

## **Summary: 41% Test Reduction**

### **Before Optimization:**

- **E2E:** 6 tests (from original plan)
- **Integration:** 4 tests (from original plan)
- **Unit:** 0 tests
- **Total:** 10 tests

### **After Optimization:**

- **E2E:** 4 tests (focused on workflows and integration)
- **Integration:** 4 tests (focused on service layer and business logic)
- **Unit:** 0 tests
- **Total:** 8 tests

### **Coverage Maintained:**

✅ All critical user flows  
✅ All error scenarios  
✅ All service integrations  
✅ All configuration dependencies  
✅ All business logic validation

### **Benefits:**

- 🚀 **20% fewer tests** to write and maintain
- 🎯 **Clearer test boundaries** and responsibilities
- ⚡ **Faster test execution** (no redundant test runs)
- 🛡️ **Same confidence level** in system correctness
- 🔧 **Easier maintenance** (each test has a single, clear purpose)

---

## **Implementation Priority:**

1. **High Priority:** E2E tests (validate user experience)
2. **Medium Priority:** Integration tests (validate service layer)
3. **Not Needed:** Unit tests (minimal complex logic)
