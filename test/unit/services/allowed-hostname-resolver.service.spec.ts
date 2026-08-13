jest.mock('node:dns/promises', () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

import { resolve4, resolve6 } from 'node:dns/promises';
import type { ConfigService } from '@nestjs/config';
import { AllowedHostnameResolverService } from '../../../src/modules/allowed-ips/allowed-hostname-resolver.service';

const mockResolve4 = resolve4 as jest.MockedFunction<typeof resolve4>;
const mockResolve6 = resolve6 as jest.MockedFunction<typeof resolve6>;

const HOSTNAME = 'api.cliente.com.br';

function buildConfigService(ttlMinutes?: string): { get: jest.Mock } {
  return {
    get: jest.fn((key: string) => (key === 'ALLOWED_HOSTNAME_DNS_TTL_MINUTES' ? ttlMinutes : undefined)),
  };
}

describe('AllowedHostnameResolverService', () => {
  let service: AllowedHostnameResolverService;

  beforeEach(() => {
    mockResolve4.mockReset();
    mockResolve6.mockReset();
    service = new AllowedHostnameResolverService(buildConfigService() as unknown as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('resolve', () => {
    it('resolves and returns the public IPv4 addresses', async () => {
      mockResolve4.mockResolvedValue(['177.207.247.1', '200.10.10.2']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toEqual(['177.207.247.1', '200.10.10.2']);
    });

    it('includes resolved IPv6 addresses alongside IPv4', async () => {
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockResolvedValue(['2606:4700:4700::1111']);

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toEqual(
        expect.arrayContaining(['177.207.247.1', '2606:4700:4700::1111']),
      );
      expect(addresses).toHaveLength(2);
    });

    it('returns every A record for DNS round-robin (multiple A records)', async () => {
      mockResolve4.mockResolvedValue(['177.1.1.1', '177.1.1.2', '177.1.1.3']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toEqual(['177.1.1.1', '177.1.1.2', '177.1.1.3']);
    });

    it('filters out private/reserved addresses, keeping only public ones', async () => {
      mockResolve4.mockResolvedValue(['10.0.0.5', '177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toEqual(['177.207.247.1']);
    });

    it('filters out loopback and link-local addresses', async () => {
      mockResolve4.mockResolvedValue(['127.0.0.1', '169.254.1.5', '177.207.247.1']);
      mockResolve6.mockResolvedValue(['::1', 'fe80::1']);

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toEqual(['177.207.247.1']);
    });

    it('returns null (fail closed) when both resolve4 and resolve6 fail and there is no prior cache', async () => {
      mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
      mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toBeNull();
    });

    it('returns null (fail closed) when every resolved address is private/reserved', async () => {
      mockResolve4.mockResolvedValue(['10.0.0.5']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toBeNull();
    });

    it('caches the result and does not call DNS again within the TTL', async () => {
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      await service.resolve(HOSTNAME);
      await service.resolve(HOSTNAME);
      await service.resolve(HOSTNAME);

      expect(mockResolve4).toHaveBeenCalledTimes(1);
    });

    it('resolves again after the TTL has expired', async () => {
      const now = Date.now();
      jest.useFakeTimers();
      jest.setSystemTime(now);
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      await service.resolve(HOSTNAME);

      jest.setSystemTime(now + 31 * 60 * 1000);

      mockResolve4.mockResolvedValue(['177.207.247.2']);

      const addresses = await service.resolve(HOSTNAME);

      expect(mockResolve4).toHaveBeenCalledTimes(2);
      expect(addresses).toEqual(['177.207.247.2']);
    });

    it('reflects a changed DNS record set once the TTL expires', async () => {
      const now = Date.now();
      jest.useFakeTimers();
      jest.setSystemTime(now);
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const firstResolution = await service.resolve(HOSTNAME);
      expect(firstResolution).toEqual(['177.207.247.1']);

      jest.setSystemTime(now + 31 * 60 * 1000);
      mockResolve4.mockResolvedValue(['200.10.10.5']);

      const secondResolution = await service.resolve(HOSTNAME);
      expect(secondResolution).toEqual(['200.10.10.5']);
    });

    it('fails closed when the TTL has expired and the refresh attempt fails, ignoring the stale cache', async () => {
      const now = Date.now();
      jest.useFakeTimers();
      jest.setSystemTime(now);
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      await service.resolve(HOSTNAME);

      jest.setSystemTime(now + 31 * 60 * 1000);
      mockResolve4.mockRejectedValue(new Error('ETIMEDOUT'));
      mockResolve6.mockRejectedValue(new Error('ETIMEDOUT'));

      const addresses = await service.resolve(HOSTNAME);

      expect(addresses).toBeNull();
    });

    it('deduplicates concurrent resolutions for the same hostname into a single DNS lookup', async () => {
      let resolveDns: (value: string[]) => void = () => {};
      mockResolve4.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDns = resolve;
          }),
      );
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const first = service.resolve(HOSTNAME);
      const second = service.resolve(HOSTNAME);
      const third = service.resolve(HOSTNAME);

      resolveDns(['177.207.247.1']);

      const results = await Promise.all([first, second, third]);

      expect(mockResolve4).toHaveBeenCalledTimes(1);
      expect(results).toEqual([['177.207.247.1'], ['177.207.247.1'], ['177.207.247.1']]);
    });

    it('resolves each hostname independently', async () => {
      mockResolve4.mockImplementation(async (hostname: string) =>
        hostname === 'a.cliente.com.br' ? ['177.1.1.1'] : ['177.1.1.2'],
      );
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      const [a, b] = await Promise.all([
        service.resolve('a.cliente.com.br'),
        service.resolve('b.cliente.com.br'),
      ]);

      expect(a).toEqual(['177.1.1.1']);
      expect(b).toEqual(['177.1.1.2']);
    });
  });

  describe('invalidate', () => {
    it('removes the cached entry so the next resolve performs a fresh DNS lookup', async () => {
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      await service.resolve(HOSTNAME);
      service.invalidate(HOSTNAME);

      mockResolve4.mockResolvedValue(['200.10.10.5']);
      const addresses = await service.resolve(HOSTNAME);

      expect(mockResolve4).toHaveBeenCalledTimes(2);
      expect(addresses).toEqual(['200.10.10.5']);
    });
  });

  describe('configurable TTL', () => {
    it('uses the configured TTL in minutes when within the valid range', async () => {
      const now = Date.now();
      jest.useFakeTimers();
      jest.setSystemTime(now);
      service = new AllowedHostnameResolverService(buildConfigService('10') as unknown as ConfigService);
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      await service.resolve(HOSTNAME);
      jest.setSystemTime(now + 11 * 60 * 1000);

      await service.resolve(HOSTNAME);

      expect(mockResolve4).toHaveBeenCalledTimes(2);
    });

    it('falls back to the default TTL when the configured value is out of range', async () => {
      const now = Date.now();
      jest.useFakeTimers();
      jest.setSystemTime(now);
      service = new AllowedHostnameResolverService(
        buildConfigService('999999') as unknown as ConfigService,
      );
      mockResolve4.mockResolvedValue(['177.207.247.1']);
      mockResolve6.mockRejectedValue(new Error('ENODATA'));

      await service.resolve(HOSTNAME);
      jest.setSystemTime(now + 35 * 60 * 1000);

      await service.resolve(HOSTNAME);

      expect(mockResolve4).toHaveBeenCalledTimes(2);
    });
  });
});
