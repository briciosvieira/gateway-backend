/** Jest config for integration tests: real test PostgreSQL database, run sequentially. */
module.exports = {
  displayName: 'integration',
  rootDir: '../',
  roots: ['<rootDir>/test/integration'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: '.*\\.integration-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/test/helpers/integration-env.setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
};
