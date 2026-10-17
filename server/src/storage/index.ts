import type { Config } from '../config/env.js';
import type { Store } from '../domain/types.js';
import { log } from '../lib/log.js';
import { FileStore } from './fileStore.js';

export { FileStore } from './fileStore.js';
export { MemoryStore } from './memoryStore.js';

/**
 * Where leads, gaps and events are saved. Without MONGODB_URI that is JSON files in
 * STORAGE_DIR (on Render the folder resets with each deploy, which is accepted for now).
 */
export function createStore(config: Config): Store {
  if (config.mongodb.uri) {
    log.warn('mongodb_not_enabled', {
      note: 'MONGODB_URI is set, but this build saves to files; the setting is ignored',
    });
  }
  return new FileStore(config.paths.storageDir);
}
