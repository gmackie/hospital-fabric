import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['apps/hospital/src/analytics.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { track } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

test('journey helper no-ops without window.dataflare', () => {
  delete globalThis.dataflare;
  assert.doesNotThrow(() => track('hospital_action_completed', { action: 'advance' }));
});

test('journey helper passes event names and enum props through, and nothing else', () => {
  const calls = [];
  globalThis.dataflare = { track: (...args) => calls.push(args) };
  try {
    track('hospital_action_completed', { action: 'arrival' });
    track('encounter_completed');
    track('hospital_action_completed', { action: 'Jane Doe' });
    track('hospital_action_completed', { action: 'advance', patientId: 'SIM-001' });
    assert.deepEqual(calls, [
      ['hospital_action_completed', { action: 'arrival' }],
      ['encounter_completed', undefined],
      ['hospital_action_completed', { action: 'advance' }],
    ]);
  } finally {
    delete globalThis.dataflare;
  }
});

test('journey helper swallows loader errors', () => {
  globalThis.dataflare = { track: () => { throw new Error('boom'); } };
  try {
    assert.doesNotThrow(() => track('encounter_completed'));
  } finally {
    delete globalThis.dataflare;
  }
});

test('loader v2 never collects patient, record, chart or API routes', async () => {
  const src = await readFile('apps/hospital/dataflare.js', 'utf8');
  for (const p of ['/patients', '/records', '/charts', '/hospital/api', '/demo/api', '/v1', '/internal'])
    assert.ok(src.includes(`'${p}'`), `exclude must list ${p}`);
  assert.match(src, /identify: false,/);
});
