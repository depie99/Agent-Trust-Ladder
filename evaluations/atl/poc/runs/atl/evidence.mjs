export function summarizeChecks(checks) {
  if (!Array.isArray(checks)) throw new TypeError('Checks must be an array');
  const names = new Set();
  const skipped = [];
  const unknown = [];
  let failed = false;
  let hasRequired = false;
  let requiredPassed = true;
  for (const check of checks) {
    if (check === null || typeof check !== 'object' || Array.isArray(check) ||
        typeof check.name !== 'string' || check.name.trim().length === 0 ||
        typeof check.required !== 'boolean' ||
        !['passed', 'failed', 'skipped', 'unknown'].includes(check.status)) {
      throw new TypeError('Malformed check');
    }
    const { name, required, status } = check;
    if (names.has(name)) throw new TypeError('Duplicate check name');
    names.add(name);
    if (status === 'skipped') skipped.push(name);
    if (status === 'unknown') unknown.push(name);
    if (status === 'failed') failed = true;
    if (required) {
      hasRequired = true;
      if (status !== 'passed') requiredPassed = false;
    }
  }
  return {
    verdict: failed ? 'failed' : hasRequired && requiredPassed ? 'complete' : 'conditional',
    skipped, unknown
  };
}
