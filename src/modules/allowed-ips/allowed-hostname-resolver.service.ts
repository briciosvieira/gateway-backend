import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve4, resolve6 } from 'node:dns/promises';
import * as ipaddr from 'ipaddr.js';
import { normalizeSourceIp } from '../gateway-proxy/utils/source-ip.util';

const DEFAULT_TTL_MINUTES = 30;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 1440;
export const ALLOWED_HOSTNAME_CACHE_TTL_MS = DEFAULT_TTL_MINUTES * 60 * 1000;

const DNS_LOOKUP_TIMEOUT_MS = 4000;

interface HostnameCacheEntry {
  addresses: string[];
  expiresAt: number;
}

/**
 * Resolves Allowed IP entries of type HOSTNAME to their current A/AAAA
 * addresses, with an in-memory cache so the Gateway Proxy never performs a
 * DNS lookup on every request. Forward DNS only — a hostname registered as
 * an Allowed Source is never derived from (or compared via) reverse DNS on
 * the request's source IP.
 *
 * Fail-closed by design: a hostname with no valid prior resolution is never
 * treated as allowing anything if DNS fails, and an expired cache entry is
 * not reused once a refresh attempt fails (no stale-if-error window in this
 * first version — see .ai/BACKEND_CONTRACTS.md).
 */
@Injectable()
export class AllowedHostnameResolverService {
  private readonly logger = new Logger(AllowedHostnameResolverService.name);
  private readonly cache = new Map<string, HostnameCacheEntry>();
  private readonly pendingResolutions = new Map<string, Promise<string[] | null>>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns the cached/resolved public IPs allowed for `hostname`, or
   * `null` if no addresses could be safely established (DNS failure, no
   * public A/AAAA records, or timeout) — callers must treat `null` as "this
   * entry grants no access", never as "allow everything".
   */
  async resolve(hostname: string): Promise<string[] | null> {
    const cached = this.cache.get(hostname);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.addresses;
    }

    const pendingResolution = this.pendingResolutions.get(hostname);

    if (pendingResolution) {
      return pendingResolution;
    }

    const resolution = this.performResolution(hostname);
    this.pendingResolutions.set(hostname, resolution);

    try {
      return await resolution;
    } finally {
      this.pendingResolutions.delete(hostname);
    }
  }

  /** Removes any cached resolution for `hostname` (create/update/delete/deactivate). */
  invalidate(hostname: string): void {
    this.cache.delete(hostname);
  }

  private async performResolution(hostname: string): Promise<string[] | null> {
    try {
      const addresses = await this.lookupPublicAddresses(hostname);

      if (addresses.length === 0) {
        throw new Error('DNS resolution returned no public A/AAAA records.');
      }

      this.cache.set(hostname, {
        addresses,
        expiresAt: Date.now() + this.getTtlMs(),
      });

      this.logger.log(
        `Allowed hostname resolved. hostname=${hostname} addressesCount=${addresses.length}`,
      );

      return addresses;
    } catch (error) {
      this.cache.delete(hostname);

      this.logger.warn(
        `Allowed hostname resolution failed. hostname=${hostname} reason=${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );

      return null;
    }
  }

  private async lookupPublicAddresses(hostname: string): Promise<string[]> {
    const [ipv4Result, ipv6Result] = await Promise.allSettled([
      this.withTimeout(resolve4(hostname), DNS_LOOKUP_TIMEOUT_MS),
      this.withTimeout(resolve6(hostname), DNS_LOOKUP_TIMEOUT_MS),
    ]);

    const rawAddresses: string[] = [
      ...(ipv4Result.status === 'fulfilled' ? ipv4Result.value : []),
      ...(ipv6Result.status === 'fulfilled' ? ipv6Result.value : []),
    ];

    if (ipv4Result.status === 'rejected' && ipv6Result.status === 'rejected') {
      throw ipv4Result.reason instanceof Error
        ? ipv4Result.reason
        : new Error('DNS resolution failed for both A and AAAA records.');
    }

    return Array.from(
      new Set(
        rawAddresses.map((address) => normalizeSourceIp(address)).filter((address) => this.isPublicAddress(address)),
      ),
    );
  }

  /**
   * Rejects loopback, RFC1918/RFC4193 private ranges, link-local, multicast,
   * unspecified and other reserved ranges — a hostname allowed source must
   * resolve to a genuinely public address to reduce DNS rebinding /
   * misconfiguration risk. This restriction intentionally does not apply to
   * directly registered IP/CIDR entries, which may legitimately be internal.
   */
  private isPublicAddress(address: string): boolean {
    try {
      return ipaddr.parse(address).range() === 'unicast';
    } catch {
      return false;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`DNS lookup timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private getTtlMs(): number {
    const configuredValue = this.configService.get<string>('ALLOWED_HOSTNAME_DNS_TTL_MINUTES');
    const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : Number.NaN;

    const minutes =
      Number.isFinite(parsedValue) && parsedValue >= MIN_TTL_MINUTES && parsedValue <= MAX_TTL_MINUTES
        ? parsedValue
        : DEFAULT_TTL_MINUTES;

    return minutes * 60 * 1000;
  }
}
