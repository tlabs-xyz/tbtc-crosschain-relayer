import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  // Global ignores - these apply to all subsequent configurations
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
    ],
  },
  // Config for Jest global setup/teardown files
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
      sourceType: 'commonjs',
    },
    rules: {
      'no-undef': 'error', // These files should have well-defined globals
      // Add any other specific rules if needed
    },
  },
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
  // TypeScript specific configuration
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser, // Specifies the ESLint parser for TypeScript (from .eslintrc.js)
      parserOptions: {
        ecmaVersion: 'latest', // Allows for the parsing of modern ECMAScript features (from .eslintrc.js)
        sourceType: 'module', // Allows for the use of imports (from .eslintrc.js)
        project: './tsconfig.json', // Important for rules requiring type information (from .eslintrc.js)
      },
      globals: {
        ...globals.node, // Enables Node.js global variables and Node.js scoping (from .eslintrc.js env.node)
        ...globals.jest, // Adds Jest global variables (from .eslintrc.js env.jest)
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin, // Loads the plugin "@typescript-eslint/eslint-plugin" (from .eslintrc.js)
      prettier: prettierPlugin, // Loads the plugin "eslint-plugin-prettier" (from .eslintrc.js)
      import: importPlugin, // Use the imported plugin object
    },
    settings: { // Added to help eslint-plugin-import resolve TS paths
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
        node: true,
      },
    },
    rules: {
      // Start with recommended rules and override as needed
      ...tsPlugin.configs.recommended.rules, // Uses the recommended rules from @typescript-eslint/eslint-plugin (from .eslintrc.js extends)
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules, // Uses the recommended rules from ESLint (from .eslintrc.js extends)
      ...prettierConfig.rules, // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors (from .eslintrc.js extends plugin:prettier/recommended)

      // Custom rules / Overrides from .eslintrc.js
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }, // Rule to find unused variables/imports (from .eslintrc.js)
      ],
      '@typescript-eslint/no-explicit-any': 'warn', // Warn about using 'any' type (from .eslintrc.js)

      // Additional rules from existing eslint.config.js, kept for consistency
      'prettier/prettier': 'error',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Enforce .js extension for all local imports
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          js: 'always',
          ts: 'never',
        },
      ],
    },
  },
];
