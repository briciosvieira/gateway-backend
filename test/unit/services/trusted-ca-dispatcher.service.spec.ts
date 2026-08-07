const agentInstances: Array<{
  close: jest.Mock<Promise<void>, []>;
  options: unknown;
}> = [];

jest.mock('undici', () => ({
  Agent: jest.fn().mockImplementation((options: unknown) => {
    const instance = {
      close: jest.fn().mockResolvedValue(undefined),
      options,
    };

    agentInstances.push(instance);

    return instance;
  }),
}));

import { rootCertificates } from 'node:tls';
import { Agent } from 'undici';
import { TrustedCaDispatcherService } from '../../../src/modules/trusted-cas/trusted-ca-dispatcher.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T) => {
      if (!resolvePromise) {
        throw new Error('Deferred promise resolver is not available.');
      }

      resolvePromise(value);
    },
  };
}

describe('TrustedCaDispatcherService', () => {
  let service: TrustedCaDispatcherService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new TrustedCaDispatcherService(prisma);
    agentInstances.length = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  it('reuses the same dispatcher instance between requests without querying the database again', async () => {
    prisma.trustedCa.findMany.mockResolvedValue([]);

    const firstDispatcher = await service.getDispatcher();
    const secondDispatcher = await service.getDispatcher();

    expect(firstDispatcher).toBe(secondDispatcher);
    expect(prisma.trustedCa.findMany).toHaveBeenCalledTimes(1);
    expect(Agent).toHaveBeenCalledWith({
      connect: {
        rejectUnauthorized: true,
      },
    });
  });

  it('combines Node public roots with active internal certificates', async () => {
    prisma.trustedCa.findMany.mockResolvedValue([
      { certificatePem: 'CERT-A' },
      { certificatePem: 'CERT-B' },
      { certificatePem: 'CERT-A' },
    ] as never);

    await service.getDispatcher();

    expect(Agent).toHaveBeenCalledWith({
      connect: {
        rejectUnauthorized: true,
        ca: [...rootCertificates, 'CERT-A', 'CERT-B'],
      },
    });
  });

  it('closes the previous dispatcher on invalidation and builds a new one for subsequent requests', async () => {
    prisma.trustedCa.findMany.mockResolvedValue([]);

    const firstDispatcher = await service.getDispatcher();

    await service.invalidateDispatcher();

    const secondDispatcher = await service.getDispatcher();

    expect(agentInstances[0].close).toHaveBeenCalledTimes(1);
    expect(firstDispatcher).not.toBe(secondDispatcher);
    expect(Agent).toHaveBeenCalledTimes(2);
  });

  it('avoids reusing a stale build when invalidation happens during dispatcher creation', async () => {
    const firstQuery = createDeferred<Array<{ certificatePem: string }>>();

    prisma.trustedCa.findMany.mockImplementationOnce(() => firstQuery.promise as never);
    prisma.trustedCa.findMany.mockResolvedValueOnce([]);

    const dispatcherPromise = service.getDispatcher();

    await Promise.resolve();
    await service.invalidateDispatcher();

    firstQuery.resolve([{ certificatePem: 'CERT-A' }]);

    const dispatcher = await dispatcherPromise;

    expect(agentInstances[0].close).toHaveBeenCalledTimes(1);
    expect(dispatcher).toBe(agentInstances[1]);
    expect(Agent).toHaveBeenCalledTimes(2);
  });
});
