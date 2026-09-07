// Zero-dependency shim: Lens Studio TypeScript uses extensionless relative
// imports; Node's type stripping requires explicit ".ts". Copy the pure Core
// modules into tests/.build/ with extensions rewritten, then test the copies.
// Nothing here touches Assets/.
//
// Node runs these by STRIPPING types, not compiling them, so any Core module
// must avoid syntax that needs real transformation:
//   * no constructor parameter properties — write `private x: T` and assign in
//     the body (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX otherwise);
//   * no enums;
//   * import types with `import type`, never mixed into a value import, or the
//     stripped file asks for an export that does not exist at runtime.
// Runtime/ modules are exempt — they are compiled by Lens Studio, not by Node.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CORE = join(here, '..', 'Assets', 'Scripts', 'Binder', 'Core');
const OUT = join(here, '.build');

export function buildCore() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const file of readdirSync(CORE).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(CORE, file), 'utf8');
    const rewritten = src.replace(/(from\s+')(\.\.?\/[^']+?)(')/g, (m, a, spec, c) =>
      spec.endsWith('.ts') ? m : `${a}${spec}.ts${c}`,
    );
    writeFileSync(join(OUT, file), rewritten);
  }
  return OUT;
}
