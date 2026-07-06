/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  // Two-part flake mitigation; see jest.env-guard.js for the full rationale.
  // 1) globalSetup snapshots the pristine env; the env-guard restores it at
  //    every test-file boundary — removes the DETERMINISTIC cross-suite
  //    env-leak class (RBAC/rate-limit/flag scrambles).
  // 2) the guard also sets jest.retryTimes(2): a STOPGAP for the separate,
  //    nondeterministic cross-suite async/shared-state flake (rotating small
  //    set of suites, each green in isolation). A real regression still fails
  //    all 3 attempts. Tracked for a proper per-suite de-flake — remove the
  //    retry once that lands.
  globalSetup: '<rootDir>/jest.global-setup.js',
  setupFilesAfterEnv: ['<rootDir>/jest.env-guard.js'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
        target: 'ES2022',
        module: 'commonjs',
      },
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/db/**',
    '!src/cli/**',
  ],
};
