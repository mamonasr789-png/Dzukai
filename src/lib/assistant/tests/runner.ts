/**
 * Minimal test runner — no dependencies, works with Node --experimental-strip-types.
 */

let passCount = 0;
let failCount = 0;
const failures: string[] = [];
let currentSuite = "";

export function describe(name: string, fn: () => void): void {
  currentSuite = name;
  fn();
}

export function it(name: string, fn: () => void): void {
  try {
    fn();
    passCount++;
  } catch (e: unknown) {
    failCount++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`  FAIL [${currentSuite}] ${name}\n       ${msg}`);
  }
}

export function expect<T>(actual: T) {
  return {
    not: {
      toBe(expected: T) {
        if (actual === expected) {
          throw new Error(`Expected not ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      },
    },
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(sub: string) {
      if (!String(actual).includes(sub)) {
        throw new Error(`Expected "${String(actual).slice(0, 120)}" to contain "${sub}"`);
      }
    },
    notToContain(sub: string) {
      if (String(actual).includes(sub)) {
        throw new Error(`Expected result NOT to contain "${sub}" but it did`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(n: number) {
      if ((actual as number) <= n) {
        throw new Error(`Expected ${actual} > ${n}`);
      }
    },
    toBeGreaterThanOrEqual(n: number) {
      if ((actual as number) < n) {
        throw new Error(`Expected ${actual} >= ${n}`);
      }
    },
    toBeLessThanOrEqual(n: number) {
      if ((actual as number) > n) {
        throw new Error(`Expected ${actual} <= ${n}`);
      }
    },
    toHaveLength(n: number) {
      const len = (actual as unknown[]).length;
      if (len !== n) throw new Error(`Expected length ${n}, got ${len}`);
    },
    toBeOneOf(options: T[]) {
      if (!options.includes(actual)) {
        throw new Error(`Expected one of ${JSON.stringify(options)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

export function printResults(): void {
  const total = passCount + failCount;
  console.log(`\n${"─".repeat(60)}`);
  if (failures.length > 0) {
    console.log("\nFailed tests:");
    failures.forEach((f) => console.log(f));
  }
  console.log(`\n✅ ${passCount}/${total} tests passed${failCount > 0 ? `, ❌ ${failCount} failed` : " — all good!"}`);
  if (failCount > 0) process.exit(1);
}
