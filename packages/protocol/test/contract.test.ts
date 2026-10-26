import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { batchSchema, canonicalize } from '../src/index.js';
const fixtures = JSON.parse(
  readFileSync(new URL('../src/fixtures/batches.json', import.meta.url), 'utf8'),
) as { name: string; valid: boolean; batch: unknown }[];
for (const fixture of fixtures)
  it(`protocol contract: ${fixture.name}`, () =>
    expect(batchSchema.safeParse(fixture.batch).success).toBe(fixture.valid));
it('canonicalizes nested objects independently of insertion order', () =>
  expect(canonicalize({ z: [{ b: 2, a: 1 }], a: null })).toBe('{"a":null,"z":[{"a":1,"b":2}]}'));
