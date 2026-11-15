import { MemoryUnitOfWork } from '../../src/infrastructure/persistence/memory/memoryUnitOfWork.js';
import { defineUseCaseSuite } from '../support/useCaseSuite.js';

defineUseCaseSuite('memory', async () => new MemoryUnitOfWork());
