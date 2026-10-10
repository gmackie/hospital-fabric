import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** Synthetic ACK loss + an actual local runtime stop, not a WAN-disconnection test. */
export async function runBlackoutScenario({ request, restart, inspect, stop }) {
  await request('POST', '/v1/admin/bootstrap');
  const patient = await request('POST', '/v1/demo/patients', {
    label: `SYNTHETIC-RESTART-${Date.now()}`,
  });
  const orderInput = { patientId: patient.id, testCode: 'CBC', requestId: `restart-${Date.now()}` };
  const created = await request('POST', '/v1/demo/lab-orders', orderInput);
  const operationPath = `/v1/operations/${created.operationId}`;
  await request('POST', '/v1/demo/faults/drop-next-ack');
  const first = await request('POST', '/v1/admin/tick');
  assert.equal(first.dispatched[0]?.operationId, created.operationId);
  assert.equal(first.dispatched[0]?.state, 'outcome_unknown');
  const before = (await request('GET', operationPath)).operation;
  assert.equal(before.state, 'outcome_unknown');
  assert.equal(before.target_resource, null);
  console.log('Lost-ACK injection: LIS committed; operation is outcome_unknown.');

  // restart() kills the runtime, verifies HTTP is unavailable, and inspects durable
  // D1 state before creating a new process using the very same persistence path.
  let committed;
  await restart(() => {
    committed = inspect(before.idempotency_key);
    assert.equal(committed.orders.length, 1, 'LIS must have committed exactly one order before restart');
    assert.equal(committed.operations.length, 1);
    assert.equal(committed.operations[0].state, 'outcome_unknown');
    assert.equal(committed.outbox[0].state, 'uncertain');
    assert.equal(committed.results.length, 0);
  });
  const restored = (await request('GET', operationPath)).operation;
  assert.equal(restored.id, before.id);
  assert.equal(restored.idempotency_key, before.idempotency_key);
  assert.equal(restored.payload_hash, before.payload_hash);
  assert.equal(restored.state, 'outcome_unknown', 'Recovery must use durable state without re-bootstrap');
  const recovery = await request('POST', `${operationPath}/reconcile`);
  assert.equal(recovery.operationId, created.operationId);
  assert.equal(recovery.attempts[0]?.operationId, created.operationId);
  assert.equal(recovery.attempts[0]?.state, 'accepted');
  const accepted = (await request('GET', operationPath)).operation;
  assert.equal(accepted.target_resource, `LisOrder/${committed.orders[0].id}`);
  const replay = await request('POST', '/v1/demo/lab-orders', orderInput);
  assert.equal(replay.duplicated, true);
  assert.equal(replay.operationId, created.operationId);
  const releasePath = `/v1/demo/lis/orders/${created.operationId}/release`;
  const result = { resultText: 'SYNTHETIC: 7.5', unitCode: '10^9/L' };
  const released = await request('POST', releasePath, result);
  await request('POST', '/v1/admin/tick');
  const releasedAgain = await request('POST', releasePath, result);
  assert.equal(releasedAgain.reportId, released.reportId);
  await request('POST', '/v1/admin/tick');
  const chart = await request('GET', `/v1/demo/patients/${patient.id}/results`);
  assert.equal(chart.results.length, 1, 'Repeated release/poll must not duplicate the chart result');
  assert.equal(chart.results[0].simulated, 1);
  assert.equal(chart.results[0].source_report_id, released.reportId);
  const completed = (await request('GET', operationPath)).operation;
  assert.equal(completed.state, 'completed');
  assert.equal(completed.idempotency_key, before.idempotency_key);
  assert.equal(completed.target_resource, accepted.target_resource);
  const events = (await request('GET', `${operationPath}/events`)).events;
  for (const type of ['order.queued', 'order.outcome_unknown', 'order.accepted']) {
    assert.equal(events.filter(event => event.event_type === type).length, 1, `Exactly one ${type} event`);
  }
  await stop();
  const persisted = inspect(before.idempotency_key);
  assert.equal(persisted.orders.length, 1, 'Reconciliation must not duplicate LIS orders');
  assert.equal(persisted.orders[0].id, committed.orders[0].id, 'Original LIS order must survive unchanged');
  assert.equal(persisted.operations.length, 1);
  assert.equal(persisted.operations[0].state, 'completed');
  assert.equal(persisted.outbox.length, 1);
  assert.equal(persisted.outbox[0].state, 'delivered');
  assert.equal(persisted.results.length, 1);
  assert.equal(persisted.chart.length, 1);
  console.log(JSON.stringify({
    passed: true, runtime: 'real local workerd', restart: 'process-group SIGKILL',
    operationId: completed.id, idempotencyKey: completed.idempotency_key,
    targetResource: completed.target_resource, lisOrders: persisted.orders.length,
    lisResults: persisted.results.length, chartResults: persisted.chart.length,
    finalState: completed.state, wanDisconnected: false,
  }, null, 2));
}


const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Read the real persisted D1 SQLite files only when the runtime is stopped. Use
// Node's built-in SQLite in a separate process for Node 22's experimental flag.
function inspectD1(directory, key) {
  const program = `
    import { readdirSync } from 'node:fs';
    import { join } from 'node:path';
    import { DatabaseSync } from 'node:sqlite';
    const walk = dir => readdirSync(dir, {withFileTypes:true}).flatMap(entry =>
      entry.isDirectory() ? walk(join(dir,entry.name)) : [join(dir,entry.name)]);
    const rows = {};
    const tableNames = ['lis_orders','lis_results','integration_operations','outbox','demo_chart_results'];
    for (const path of walk(process.argv[1]).filter(path => path.endsWith('.sqlite'))) {
      const db = new DatabaseSync(path, {readOnly:true});
      try {
        for (const table of tableNames) {
          if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
            if (rows[table]) throw new Error('Unexpected duplicate D1 table: '+table);
            rows[table] = db.prepare('SELECT * FROM '+table).all();
          }
        }
      } finally { db.close(); }
    }
    for (const table of tableNames) if (!rows[table]) throw new Error('Missing persisted table: '+table);
    console.log(JSON.stringify(rows));
  `;
  const data = JSON.parse(execFileSync(process.execPath,
    ['--experimental-sqlite', '--input-type=module', '-e', program, directory],
    { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  // A fresh directory contains only this scenario. Global counts also detect
  // duplicates accidentally created with a different idempotency key.
  assert.ok(data.lis_orders.every(order => order.idempotency_key === key));
  return { orders: data.lis_orders, results: data.lis_results,
    operations: data.integration_operations, outbox: data.outbox, chart: data.demo_chart_results };
}

export async function runWorkerdSmoke() {
  if (process.platform === 'win32') throw new Error('This process-group restart smoke requires macOS or Linux.');
  const secret = readFileSync(resolve(root, 'apps/worker/.dev.vars'), 'utf8')
    .match(/^DEMO_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!secret) throw new Error('Missing demo token; run npm run dev:secrets first');
  const port = await unusedPort();
  const persistence = mkdtempSync(join(tmpdir(), 'hospital-fabric-restart-'));
  const base = `http://127.0.0.1:${port}`;
  const abort = new AbortController();
  let worker;
  let exited;
  let logs = '';
  const signalHandler = () => abort.abort(new Error('Smoke interrupted'));
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  const signal = () => AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, signal: signal(),
      headers: { 'x-demo-token': secret, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${JSON.stringify(result)}`);
    return result;
  };
  const stop = async (hard = false) => {
    if (!worker) return;
    const current = worker;
    const killGroup = signal => {
      if (!current.pid) return;
      try { process.kill(-current.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    killGroup(hard ? 'SIGKILL' : 'SIGTERM');
    await Promise.race([exited, delay(5000, undefined, { ref: false })]);
    // Kill surviving descendants even if the Wrangler launcher exited already.
    killGroup('SIGKILL');
    await Promise.race([exited, delay(2000, undefined, { ref: false })]);
    assert.ok(!current.pid || current.exitCode !== null || current.signalCode !== null, 'Wrangler did not terminate');
    worker = undefined;
    for (let i = 0; i < 20; i++) {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(250) }).catch(() => null);
      if (!response) return;
      await delay(100);
    }
    throw new Error('Local HTTP service remained reachable after runtime termination');
  };
  const start = async () => {
    abort.signal.throwIfAborted();
    worker = spawn(process.execPath, [wrangler, 'dev', '--config', 'apps/worker/wrangler.jsonc',
      '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistence,
      '--inspector-port', '0'], {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(persistence, 'wrangler.log'),
        XDG_CONFIG_HOME: join(persistence, 'config'), BROWSER: 'none', CI: '1' },
    });
    let spawnError;
    worker.once('error', error => { spawnError = error; });
    exited = new Promise(resolve => worker.once('exit', resolve));
    for (const stream of [worker.stdout, worker.stderr]) {
      stream.on('data', data => { logs = (logs + data.toString()).slice(-30000); });
    }
    for (let i = 0; i < 120; i++) {
      abort.signal.throwIfAborted();
      if (spawnError) throw spawnError;
      if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Wrangler exited before becoming healthy');
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(500) }).catch(() => null);
      if (response?.ok) {
        assert.equal((await response.json()).service, 'hospital-fabric');
        return;
      }
      await delay(500, undefined, { signal: abort.signal });
    }
    throw new Error('Local workerd did not become healthy within 60 seconds');
  };
  try {
    await start();
    await runBlackoutScenario({ request, stop, inspect: key => inspectD1(persistence, key),
      restart: async inspectWhileStopped => {
        await stop(true);
        console.log('Runtime terminated; HTTP unavailable. Reading persisted D1 before restart.');
        inspectWhileStopped();
        await start();
        console.log('New workerd process started against the same persisted D1 databases.');
      } });
  } catch (error) {
    console.error(logs.replaceAll(secret, '[REDACTED]'));
    throw error;
  } finally {
    try { await stop(); }
    finally {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
      rmSync(persistence, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWorkerdSmoke();
}
