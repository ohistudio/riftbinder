// Minimal test harness. No npm dependencies (BINDER.md § Platform).

const cases = [];
export function test(name, fn) { cases.push({ name, fn }); }

export function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}
export function assertEqual(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${msg ?? 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
export function assertDeep(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ?? 'not deep-equal'}:\n  expected ${b}\n  got      ${a}`);
}
export function assertClose(actual, expected, epsilon, msg) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${msg ?? 'not close'}: expected ~${expected}, got ${actual}`);
  }
}

export async function runAll() {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of cases) {
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { failures.push({ name, e }); console.log(`  FAIL ${name}`); }
  }
  console.log(`\n${passed}/${cases.length} passed`);
  for (const { name, e } of failures) console.log(`\n${name}\n  ${e.message}`);
  return failures.length;
}
