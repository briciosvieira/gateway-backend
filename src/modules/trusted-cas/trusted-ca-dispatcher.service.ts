import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { rootCertificates } from 'node:tls';
import { Agent } from 'undici';
import type { Dispatcher } from 'undici';
import { PrismaService } from '../../database/prisma/prisma.service';

const activeTrustedCaBundleSelect = {
  certificatePem: true,
} as const;

@Injectable()
export class TrustedCaDispatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(TrustedCaDispatcherService.name);
  private dispatcher: Agent | null = null;
  private buildPromise: Promise<Agent> | null = null;
  private generation = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getDispatcher(): Promise<Agent> {
    if (this.dispatcher) {
      return this.dispatcher;
    }

    if (!this.buildPromise) {
      const buildGeneration = this.generation;

      this.buildPromise = (async () => {
        const dispatcher = await this.buildDispatcher();

        if (buildGeneration !== this.generation) {
          await this.closeDispatcher(
            dispatcher,
            'Failed to close a stale trusted CA dispatcher after cache invalidation.',
          );

          return this.getDispatcher();
        }

        this.dispatcher = dispatcher;

        return dispatcher;
      })();
    }

    const currentBuildPromise = this.buildPromise;

    try {
      return await currentBuildPromise;
    } finally {
      if (this.buildPromise === currentBuildPromise) {
        this.buildPromise = null;
      }
    }
  }

  async invalidateDispatcher(): Promise<void> {
    const previousDispatcher = this.dispatcher;

    this.generation += 1;
    this.dispatcher = null;
    this.buildPromise = null;

    if (!previousDispatcher) {
      return;
    }

    await this.closeDispatcher(
      previousDispatcher,
      'Failed to close the previous trusted CA dispatcher cleanly.',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.invalidateDispatcher();
  }

  private async buildDispatcher(): Promise<Agent> {
    const activeCertificates = await this.getActiveCertificates();
    const additionalCaBundle = Array.from(new Set(activeCertificates));

    return new Agent({
      connect: {
        rejectUnauthorized: true,
        ...(additionalCaBundle.length > 0
          ? {
              ca: [...rootCertificates, ...additionalCaBundle],
            }
          : {}),
      },
    });
  }

  private async getActiveCertificates(): Promise<string[]> {
    const activeTrustedCas = await this.prisma.trustedCa.findMany({
      where: {
        active: true,
        validTo: {
          gt: new Date(),
        },
      },
      select: activeTrustedCaBundleSelect,
    });

    return activeTrustedCas.map((trustedCa) => trustedCa.certificatePem);
  }

  private async closeDispatcher(dispatcher: Agent, message: string): Promise<void> {
    await dispatcher.close().catch((error: unknown) => {
      this.logger.error(message, error instanceof Error ? error.stack : undefined);
    });
  }
}
