// jest.global-teardown.js - Jest global teardown for tBTC cross-chain relayer
//
// This script cleans up the test environment after Jest has finished running all tests.
// It deletes mock chain config files and removes the mock config directory if empty.

import fs from 'fs';
import path from 'path';
import { allMockChainConfigs } from './tests/mocks/mock.chain.configs.ts';

const MOCK_CONFIG_DIR = path.join(__dirname, 'config', 'chain');

// =====================
// Jest Global Teardown Function
// =====================

export default async () => {
  // Only print errors and a final summary message

  // =====================
  // Delete Mock Config Files
  // =====================
  allMockChainConfigs.forEach((config) => {
    const filePath = path.join(MOCK_CONFIG_DIR, `${config.chainName}.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`Jest Global Teardown: Error deleting mock config file ${filePath}:`, error);
      }
    }
  });

  // =====================
  // Remove Mock Config Directory if Empty
  // =====================
  if (fs.existsSync(MOCK_CONFIG_DIR)) {
    try {
      // Check if directory is empty before attempting to remove
      const files = fs.readdirSync(MOCK_CONFIG_DIR);
      if (files.length === 0) {
        fs.rmdirSync(MOCK_CONFIG_DIR);
      }
    } catch (error) {
      console.error(
        `Jest Global Teardown: Error removing mock config directory ${MOCK_CONFIG_DIR}:`,
        error,
      );
    }
  }

  // =====================
  // Finalization
  // =====================
  console.log('Jest Global Teardown: Completed.');
};
