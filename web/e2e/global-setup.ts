import { mkdirSync, rmSync } from 'node:fs';
import { E2E_DATA_DIR } from './env.ts';

/** Starts every run with empty storage and email preview folders. */
export default function globalSetup(): void {
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });
}
