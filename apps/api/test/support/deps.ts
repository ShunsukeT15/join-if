import type { Deps } from '../../src/application/deps.js';
import type { UnitOfWork } from '../../src/application/ports/persistence.js';
import type { Clock } from '../../src/application/ports/services.js';
import {
  generateEncryptionKey,
  NodeIdGenerator,
  NodeTokenService,
} from '../../src/infrastructure/crypto/nodeTokenService.js';
import { MemoryUnitOfWork } from '../../src/infrastructure/persistence/memory/memoryUnitOfWork.js';

export class TestClock implements Clock {
  constructor(private t = new Date('2026-11-18T10:40:00Z').getTime()) {}
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t += ms;
  }
  advanceDays(days: number) {
    this.t += days * 24 * 60 * 60 * 1000;
  }
}

export type TestDeps = Deps & { clock: TestClock };

export function makeDeps(uow: UnitOfWork = new MemoryUnitOfWork()): TestDeps {
  return {
    uow,
    tokens: new NodeTokenService(generateEncryptionKey()),
    ids: new NodeIdGenerator(),
    clock: new TestClock(),
  };
}

export const admin = (token: string | undefined) => ({ kind: 'admin' as const, token });
export const invite = (token: string | undefined) => ({ kind: 'invite' as const, token });
export const member = (token: string | undefined) => ({ kind: 'member' as const, token });
