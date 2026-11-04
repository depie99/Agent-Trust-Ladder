export function summarizeChecks(checks) {
  if (!Array.isArray(checks)) throw new TypeError('Checks must be an array');
  const names = new Set();
  const skipped = [];
  const unknown = [];
  let failed = false;
  let requiredCount = 0;
  let requiredPassed = true;
  for (const check of checks) {
    if (check === null || typeof check !== 'object' || Array.isArray(check) ||
        typeof check.name !== 'string' || check.name.trim().length === 0 ||
        typeof check.required !== 'boolean' ||
        !['passed', 'failed', 'skipped', 'unknown'].includes(check.status)) {
      throw new TypeError('Malformed check');
    }
    if (names.has(check.name)) throw new Error('Duplicate check name');
    names.add(check.name);
    if (check.status === 'skipped') skipped.push(check.name);
    if (check.status === 'unknown') unknown.push(check.name);
    if (check.status === 'failed') failed = true;
    if (check.required) {
      requiredCount++;
      if (check.status !== 'passed') requiredPassed = false;
    }
  }
  return {
    verdict: failed ? 'failed' : requiredCount > 0 && requiredPassed ? 'complete' : 'conditional',
    skipped,
    unknown,
  };
}
