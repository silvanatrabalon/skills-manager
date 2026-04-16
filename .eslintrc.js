module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'eslint:recommended',
  ],
  env: {
    node: true,
    es2020: true
  },
  globals: {
    console: 'readonly',
    Thenable: 'readonly'
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-explicit-any': 'off',
    'semi': 'warn',
    'curly': 'warn',
    'eqeqeq': 'warn',
    'no-throw-literal': 'warn',
    'no-useless-escape': 'off'
  },
  ignorePatterns: ['out', 'dist', '**/*.d.ts'],
};