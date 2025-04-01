module.exports = {
  root: true, // Prevent ESLint from looking further up the directory tree
  parser: '@typescript-eslint/parser', // Specifies the ESLint parser for TypeScript
  parserOptions: {
    ecmaVersion: 2021, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module', // Allows for the use of imports
    project: './tsconfig.json', // Important for rules requiring type information
  },
  env: {
    node: true, // Enables Node.js global variables and Node.js scoping.
    jest: true, // Adds Jest global variables.
  },
  plugins: [
    '@typescript-eslint', // Loads the plugin "@typescript-eslint/eslint-plugin"
    'prettier', // Loads the plugin "eslint-plugin-prettier"
  ],
  extends: [
    'eslint:recommended', // Uses the recommended rules from ESLint
    'plugin:@typescript-eslint/recommended', // Uses the recommended rules from @typescript-eslint/eslint-plugin
    // 'plugin:@typescript-eslint/recommended-requiring-type-checking', // Optional: More rules requiring type info (can be slower)
    'plugin:prettier/recommended', // Enables eslint-plugin-prettier and eslint-config-prettier. Displays prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
  ],
  rules: {
    // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
    // e.g. "@typescript-eslint/explicit-function-return-type": "off",
    '@typescript-eslint/no-unused-vars': [
      'warn', // or 'error'
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ], // Rule to find unused variables/imports
    '@typescript-eslint/no-explicit-any': 'warn', // Warn about using 'any' type
    // Add other custom rules here
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    'logs/',
    '*.log',
    'jest.config.js', // Often uses require
    '.eslintrc.js', // This config file
    // Add other files/patterns to ignore
  ],
};
