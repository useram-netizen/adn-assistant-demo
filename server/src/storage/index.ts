import type { Config } from '../config/env.js';
import type { Store } from '../domain/types.js';
import { log } from '../lib/log.js';
import { FileStore } from './fileStore.js';
import { MongoStore } from './mongoStore.js';
import { ResilientStore } from './resilientStore.js';

export { FileStore } from './fileStore.js';
export { MemoryStore } from './memoryStore.js';
export { MongoStore } from './mongoStore.js';
export { ResilientStore } from './resilientStore.js';

/**
 * Where leads, gaps and events are saved. Without MONGODB_URI that is JSON files in
 * STORAGE_DIR (on Render the folder resets with each deploy, which is accepted for now).
 * With it, MongoDB is used and the files are the safety net if it can't be reached.
 */
export function createStore(config: Config): Store {
  const files = new FileStore(config.paths.storageDir);
  if (!config.mongodb.uri) return files;
  log.info('mongodb_configured', { db: config.mongodb.db });
  return new ResilientStore(new MongoStore(config.mongodb.uri, config.mongodb.db), files);
}
