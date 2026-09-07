import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { buildCore } from './build.mjs';
import { runAll } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
buildCore();

for (const f of readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(join(here, f)).href);
}

process.exit((await runAll()) === 0 ? 0 : 1);
