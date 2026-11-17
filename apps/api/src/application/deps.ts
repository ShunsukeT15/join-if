import type { RetentionPolicy } from '../domain/constants.js';
import type { UnitOfWork } from './ports/persistence.js';
import type { Clock, IdGenerator, TokenService } from './ports/services.js';

export interface Deps {
  uow: UnitOfWork;
  tokens: TokenService;
  ids: IdGenerator;
  clock: Clock;
  retention: RetentionPolicy;
}
