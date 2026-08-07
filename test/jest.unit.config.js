/** Jest config for unit tests: utils and services, Prisma fully mocked, no database access. */
module.exports = {
  displayName: 'unit',
  rootDir: '../',
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Unit tests target business logic (services + utils) with Prisma fully mocked, per the
  // suite's own scope ("Mockar Prisma. Não utilizar banco."). Controllers, guards, filters,
  // interceptors and Fastify-level hooks are exercised end-to-end by the integration/e2e
  // suites instead — including them here would just show as permanent 0% and distort the
  // threshold, since this config never boots the real HTTP pipeline.
  collectCoverageFrom: [
    'src/modules/**/*.service.ts',
    'src/modules/**/utils/**/*.ts',
    'src/modules/users/policies/**/*.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/unit',
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 90,
      functions: 95,
      lines: 95,
    },
  },
  maxWorkers: '50%',
};
