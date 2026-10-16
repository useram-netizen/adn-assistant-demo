import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** The server/ folder. This file is in server/src (tsx) or server/dist (built), one level down. */
export const serverRoot = fileURLToPath(new URL('..', import.meta.url));
export const repoRoot = join(serverRoot, '..');

/** The widget build from web/ (npm run build -w web). */
export const widgetDistDir = join(repoRoot, 'web', 'dist');
/** The embed script source; the server fills in its settings when serving it. */
export const embedScriptPath = join(serverRoot, 'static', 'embed.js');
export const envFilePath = join(repoRoot, '.env');
