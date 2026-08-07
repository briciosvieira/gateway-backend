import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaService } from '../../src/database/prisma/prisma.service';

export type MockPrismaService = DeepMockProxy<PrismaService>;

export function createMockPrismaService(): MockPrismaService {
  return mockDeep<PrismaService>();
}

export function resetMockPrismaService(mock: MockPrismaService): void {
  mockReset(mock);
}

/**
 * Mocks `$transaction([...])` (array form) to resolve with the given results,
 * in order. Matches the pattern used across services for paginated listings:
 * `const [items, total] = await this.prisma.$transaction([findMany, count])`.
 */
export function mockTransactionArray(mock: MockPrismaService, results: unknown[]): void {
  mock.$transaction.mockImplementationOnce(async () => results as never);
}

/**
 * Mocks `$transaction(callback)` (interactive form) by invoking the callback
 * with the mock itself, so nested calls like `transaction.user.update(...)`
 * resolve against the same mocked methods already configured on the test.
 */
export function mockTransactionCallback(mock: MockPrismaService): void {
  mock.$transaction.mockImplementationOnce(async (callback: unknown) => {
    if (typeof callback === 'function') {
      return (callback as (tx: MockPrismaService) => unknown)(mock);
    }

    return undefined;
  });
}
