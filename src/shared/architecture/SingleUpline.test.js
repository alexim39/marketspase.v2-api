import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Single source of truth guard.
 *
 * `partnerOf` is the only upline edge. The legacy campaign-parent field was
 * migrated away and must never return to application code; only the one-shot
 * migration script under `scripts/` may mention it. This test fails the suite
 * if a future change reintroduces the old field.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY_FIELD = ['placementParent', 'Id'].join('');

const files = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (statSync(full).isDirectory()) return files(full);
  return full.endsWith('.js') ? [full] : [];
});

test('application code has no legacy parent field', () => {
  const offenders = files(SRC)
    .filter((file) => readFileSync(file, 'utf8').includes(LEGACY_FIELD))
    .map((file) => file.replace(`${SRC}\\`, '').replace(`${SRC}/`, ''));

  assert.deepEqual(offenders, [], `Remove ${LEGACY_FIELD} from: ${offenders.join(', ')}`);
});

test('the partner schema keeps partnerOf as the upline', () => {
  const model = readFileSync(join(SRC, 'apps', 'partner', 'models', 'partner.model.js'), 'utf8');
  assert.match(model, /partnerOf:\s*\{/);
  assert.match(model, /systemOwned:\s*\{/);
});
