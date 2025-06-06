/**
 * ESLint configuration for tBTC cross-chain relayer project.
 * Defines parser, plugins, rules, and environment settings.
 *
 * This file defines linting rules, plugins, and settings for both TypeScript and JavaScript codebases.
 * It enforces code quality, style, and import conventions, and is structured for maintainability and onboarding.
 *
 * Update this file to add, remove, or clarify linting rules and project-specific conventions.
 */
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  // ===== Global ignores =====
  // These apply to all subsequent configurations
  {
    ignores: [
      'node_modules/',
      'dist/', // Ignore all compiled output
      'build/',
      'coverage/',
      'logs/',
      '*.log',
      'jest.config.cjs',
      'jest.setup.js',
      'test/', // Added to ignore Hardhat contract tests
      'generated/', // Migrated from .eslintignore
    ],
  },
  // ===== Jest global setup/teardown config =====
  {
    files: ['jest.global-setup.js', 'jest.global-teardown.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest, // Jest might inject some globals here too
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
      },
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'error', // These files should have well-defined globals
      // Add any other specific rules if needed
    },
  },
  // ===== .mjs files config =====
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'error',
    },
  },
  // ===== JavaScript config =====
  js.configs.recommended,
  {
    files: ['.js', '*.config.js'],
    ignores: ['jest.global-setup.js', 'jest.global-teardown.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
      },
      sourceType: 'commonjs', // Assume CommonJS for .js files unless specified otherwise in package.json
    },
    rules: {
      'no-undef': 'warn',
      'no-case-declarations': 'off', // Also turn off for JS if necessary
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'require-yield': 'off', // Often a false positive for transpiled async without await
    },
  },
  // ===== TypeScript config =====
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser, // Specifies the ESLint parser for TypeScript
      parserOptions: {
        ecmaVersion: 'latest', // Allows for the parsing of modern ECMAScript features
        sourceType: 'module', // Allows for the use of imports
        project: './tsconfig.json', // Important for rules requiring type information
      },
      globals: {
        ...globals.node, // Enables Node.js global variables and Node.js scoping
        ...globals.jest, // Adds Jest global variables
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin, // Loads the plugin "@typescript-eslint/eslint-plugin"
      prettier: prettierPlugin, // Loads the plugin "eslint-plugin-prettier"
      import: importPlugin, // Use the imported plugin object
    },
    settings: {
      // Added to help eslint-plugin-import resolve TS paths
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
        node: true,
      },
    },
    rules: {
      // ===== Recommended rules and overrides =====
      ...tsPlugin.configs.recommended.rules, // Uses the recommended rules from @typescript-eslint/eslint-plugin
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules, // Uses the recommended rules from ESLint
      ...prettierConfig.rules, // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors

      // ===== Custom rules / Overrides =====
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }, // Rule to find unused variables/imports
      ],
      '@typescript-eslint/no-explicit-any': 'warn', // Warn about using 'any' type

      // Additional rules from existing eslint.config.js, kept for consistency
      'prettier/prettier': 'error',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Enforce .js extension for all local imports that will be .js at runtime
      'import/extensions': [
        'error',
        'always', // Default behavior: require extensions
        {
          ignorePackages: true,
          pattern: {
            js: 'always', // Imports of .js files must have .js
            mjs: 'always', // Imports of .mjs files must have .mjs
            cjs: 'always', // Imports of .cjs files must have .cjs
            ts: 'never', // Do NOT allow './foo.ts' in import statements in TS files
            tsx: 'never', // Do NOT allow './foo.tsx' in import statements in TS files
          },
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
    },
  },
];
