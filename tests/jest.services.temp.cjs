module.exports = {
  "displayName": "Service Tests",
  "preset": "ts-jest",
  "testEnvironment": "node",
  "roots": [
    "<rootDir>/unit/services"
  ],
  "testMatch": [
    "<rootDir>/unit/services/**/*.test.ts"
  ],
  "transform": {
    "^.+\\.ts$": "ts-jest"
  },
  "moduleFileExtensions": [
    "ts",
    "js",
    "json"
  ],
  "setupFilesAfterEnv": [
    "<rootDir>/setup.ts"
  ],
  "moduleNameMapping": {
    "^ethers$": "<rootDir>/mocks/ethers.mock.js"
  },
  "clearMocks": true,
  "restoreMocks": true
};