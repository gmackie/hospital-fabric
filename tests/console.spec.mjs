import { test, expect } from '@playwright/test';

const TOKEN = 'synthetic-browser-test-token-only';
const headers = { 'x-demo-token': TOKEN };
const button = (page, name) => page.getByRole('button', { name, exact: true });
const selected = page => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Selected operation', exact: true }) });
async function connect(page, token = TOKEN) {
  await page.goto('/');
  await page.getByLabel('Local demo token').fill(token);
  await button(page, 'Connect').click();
  await expect(button(page, 'Initialize demo')).toBeEnabled();
}
async function initialize(page) {
  await button(page, 'Initialize demo').click();
  await expect(page.getByRole('status')).toContainText('Demo tables initialized');
}
async function register(page) {
  await button(page, 'Register synthetic patient').click();
  await expect(page.getByRole('status')).toContainText('Synthetic patient registered');
}
async function queue(page, label = 'Queue CBC') {
  const response = page.waitForResponse(r => r.url().endsWith('/v1/demo/lab-orders') && r.request().method() === 'POST');
  await button(page, label).click();
  const payload = await (await response).json();
  await expect(button(page, 'Prepare another CBC')).toBeEnabled();
  return payload.operationId;
}

const externalRequests = new WeakMap();
test.beforeEach(async ({ page, request }, testInfo) => {
  const attempted = [];
  externalRequests.set(page, attempted);
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:9878') attempted.push(request.url());
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:9878'
    ? route.continue() : route.abort('blockedbyclient'));
  if (!testInfo.title.startsWith('local Worker console')) {
    const initialized = await request.post('/v1/admin/bootstrap', { headers, data: {} });
    expect(initialized.ok()).toBe(true);
  }
});
test.afterEach(async ({ page }) => {
  // This proves browser asset/API locality, not a physical WAN-disconnection test.
  expect(externalRequests.get(page)).toEqual([]);
});

test('local Worker console drives lost ACK, selected reconciliation, and result completion', async ({ page, request }, testInfo) => {
  await connect(page);
  await expect(page.getByRole('alert')).toContainText('500'); // Fresh D1 needs explicit setup.
  await initialize(page);
  await register(page);
  const operationId = await queue(page);
  await expect(selected(page)).toContainText('Queued');
  await button(page, 'Arm lost ACK').click();
  await expect(page.getByRole('status')).toContainText('Lost ACK armed');
  await button(page, 'Tick delivery / poll results').click();
  await expect(selected(page)).toContainText('Unknown outcome');
  await expect(selected(page)).toContainText('delivery.attempt_started');
  await expect(button(page, 'Release simulated result')).toBeDisabled();

  // An unrelated queued operation must not be dispatched by selected-only reconciliation.
  await button(page, 'Prepare another CBC').click();
  const otherId = await queue(page);
  await page.getByRole('button').filter({ hasText: operationId }).click();
  const reconciliation = page.waitForRequest(r => r.url().endsWith(`/v1/operations/${operationId}/reconcile`));
  await button(page, 'Reconcile selected only').click();
  await reconciliation;
  await expect(selected(page)).toContainText('Accepted');
  await expect(selected(page)).toContainText('delivery.lookup_completed');
  await expect(selected(page)).toContainText('delivery.reconciled');
  await expect(button(page, 'Reconcile selected only')).toBeDisabled();
  const other = await request.get(`/v1/operations/${otherId}`, { headers });
  expect((await other.json()).operation.state).toBe('queued');

  await button(page, 'Release simulated result').click();
  await expect(page.getByRole('status')).toContainText('Simulated result released');
  await button(page, 'Tick delivery / poll results').click();
  await expect(selected(page)).toContainText('Completed');
  await expect(selected(page)).toContainText('result.imported');
  await expect(selected(page)).toContainText('SYNTHETIC: 7.5');
  await expect(button(page, 'Release simulated result')).toBeDisabled();
  await button(page, 'Tick delivery / poll results').click();
  await expect(button(page, 'Refresh read-only')).toBeEnabled();
  await expect(selected(page).getByText('result.imported', { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('completed-console.png'), fullPage: true });
});

test('wrong token is visible, disconnect recovers, reload never retains credentials', async ({ page }) => {
  await connect(page, 'wrong-token-for-synthetic-test');
  await expect(page.getByRole('alert')).toContainText('401');
  await button(page, 'Disconnect & clear').click();
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
  await page.getByLabel('Local demo token').fill(TOKEN);
  await button(page, 'Connect').click();
  await expect(page.getByRole('status')).toContainText('Connected to this local demo');
  const persisted = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  expect(JSON.stringify(persisted)).not.toContain(TOKEN);
  await page.reload();
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
  await expect(button(page, 'Initialize demo')).toHaveCount(0);
});

test('double activation is guarded and an interrupted CBC retries its original request ID', async ({ page, request }) => {
  await connect(page);
  await register(page);
  const submissions = [];
  let loseResponse = true;
  await page.route('**/v1/demo/lab-orders', async route => {
    submissions.push(route.request().postDataJSON());
    const response = await route.fetch(); // Commit in the actual local Worker first.
    if (loseResponse) { loseResponse = false; await route.abort('failed'); }
    else await route.fulfill({ response });
  });
  await button(page, 'Queue CBC').evaluate(element => { element.click(); element.click(); });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(submissions).toHaveLength(1);
  await expect(button(page, 'Retry same CBC')).toBeEnabled();
  await button(page, 'Retry same CBC').click();
  await expect(page.getByRole('status')).toContainText('Existing CBC recovered');
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  await expect(button(page, 'Queue CBC')).toBeDisabled();
  const response = await request.get('/v1/operations', { headers });
  const orders = (await response.json()).orders.filter(o => o.patient_id === submissions[0].patientId);
  expect(orders).toHaveLength(1);
});

test('disconnect suppresses late reads and clears selected operation details', async ({ page }) => {
  await connect(page);
  await expect(page.getByRole('status')).toContainText('Connected to this local demo');
  await register(page);
  await queue(page);
  const firstOrder = page.locator('.orders button').first();
  await firstOrder.click();
  await expect(selected(page).locator('.mono').first()).toBeVisible();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  await page.route('**/v1/operations', async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await button(page, 'Refresh read-only').click();
  await pending;
  await button(page, 'Disconnect & clear').click();
  release();
  await expect(page.getByLabel('Local demo token')).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('Disconnected.');
  await expect(page.getByRole('heading', { name: 'Selected operation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('untrusted timeline and result strings render as text under the Worker CSP', async ({ page }) => {
  const payload = '<img src=x onerror="window.__consoleXss=1">';
  await page.route('**/v1/operations/*/events', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.events.push({ id: 'synthetic-xss-test', event_type: payload, details_json: payload, occurred_at: Date.now() });
    await route.fulfill({ response, json: data });
  });
  await page.route('**/v1/demo/patients/*/results', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.results.push({ source_report_id: 'synthetic-xss-result', test_code: 'CBC', result_text: payload, unit_code: '' });
    await route.fulfill({ response, json: data });
  });
  const response = await page.goto('/');
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  await page.getByLabel('Local demo token').fill(TOKEN);
  await button(page, 'Connect').click();
  await expect(button(page, 'Initialize demo')).toBeEnabled();
  await register(page);
  await queue(page);
  await page.locator('.orders button').first().click();
  await expect(selected(page)).toContainText(payload);
  await expect(selected(page).locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__consoleXss)).toBeUndefined();
});

test('hospital simulation completes medical and surgical journeys, survives reload and queues outage summaries', async ({ page, context }) => {
  await page.goto('/hospital');
  await expect(page.getByRole('heading',{name:'A hospital, in motion.'})).toBeVisible();
  const encounter=page.getByRole('region',{name:'Selected encounter'});
  await page.getByRole('button',{name:'Simulate WAN outage',exact:true}).click();
  for(const label of ['Register patient','Request laboratory','Deliver lab order','Reconcile acknowledgment','Release lab result','Allocate ward bed','Complete ward stay','Dispense & discharge']){
    await encounter.getByRole('button',{name:label+' →',exact:true}).click();
  }
  await expect(encounter.getByRole('button',{name:'Journey completed →'})).toBeDisabled();
  await expect(page.getByRole('region',{name:'Hospital status'})).toContainText('1 summaries awaiting WAN');
  await page.reload();await expect(encounter.getByRole('button',{name:'Journey completed →'})).toBeDisabled();
  await page.getByRole('button',{name:/RD Robin Demo/}).click();
  for(const label of ['Register patient','Request laboratory','Deliver lab order','Reconcile acknowledgment','Release lab result','Complete imaging','Allocate ward bed','Book theatre','Complete procedure','Complete recovery','Dispense & discharge']){
    await encounter.getByRole('button',{name:label+' →',exact:true}).click();
  }
  await expect(encounter).toContainText('Synthetic study');
  await expect(page.getByRole('region',{name:'Hospital status'})).toContainText('2 summaries awaiting WAN');
  await page.getByRole('button',{name:'Restore WAN',exact:true}).click();
  await expect(page.getByRole('region',{name:'Hospital status'})).toContainText('0 summaries awaiting WAN');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'A hospital, in motion.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
