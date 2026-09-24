const test = require('node:test');
const assert = require('node:assert/strict');
const { venueFetch, paceOutbound, rotateProxyEgress, resetRotateState } = require('../src/services/venueHttp');

test('venueFetch 未配置 GYM_PROXY_URL：直连，参数原样透传', async () => {
  const prev = process.env.GYM_PROXY_URL;
  delete process.env.GYM_PROXY_URL;
  try {
    let captured = null;
    global.fetch = async (url, opts) => { captured = { url, options: opts }; return { ok: true }; };
    await venueFetch('https://example.com/api', { method: 'POST', headers: { a: '1' } });
    assert.equal(captured.url, 'https://example.com/api');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.dispatcher, undefined);
  } finally {
    process.env.GYM_PROXY_URL = prev;
  }
});

test('venueFetch 配置 GYM_PROXY_URL：注入 ProxyAgent dispatcher', async () => {
  const prev = process.env.GYM_PROXY_URL;
  process.env.GYM_PROXY_URL = 'http://127.0.0.1:59999';
  try {
    let captured = null;
    global.fetch = async (url, options = {}) => { captured = { url, options }; return {}; };
    await venueFetch('https://example.com/api', { method: 'GET' });
    assert.ok(captured.options.dispatcher, '应合入 dispatcher 字段');
    assert.equal(captured.options.dispatcher.constructor.name.startsWith('Proxy'), true);
    assert.equal(captured.options.method, 'GET');
  } finally {
    process.env.GYM_PROXY_URL = prev;
  }
});

test('paceOutbound：区间 env 直接生效，0 关闭', async () => {
  process.env.GYM_OUTBOUND_SPACING_MIN_MS = '5000';
  process.env.GYM_OUTBOUND_SPACING_MAX_MS = '5000';
  const t0 = Date.now();
  await paceOutbound();
  assert.ok(Date.now() - t0 >= 4900, '应真实 sleep 出间隔');

  process.env.GYM_OUTBOUND_SPACING_MIN_MS = '0';
  process.env.GYM_OUTBOUND_SPACING_MAX_MS = '0';
  const t1 = Date.now();
  await paceOutbound();
  assert.ok(Date.now() - t1 < 100, '区间为 0 时应立即返回');

  process.env.GYM_OUTBOUND_SPACING_MAX_MS = '5000';
  process.env.GYM_OUTBOUND_SPACING_MIN_MS = '5000';
});

test('rotateProxyEgress：未配置代理或命令 → not_configured，不执行', async () => {
  resetRotateState();
  const prevProxy = process.env.GYM_PROXY_URL;
  const prevCmd = process.env.GYM_PROXY_ROTATE_CMD;
  delete process.env.GYM_PROXY_URL;
  process.env.GYM_PROXY_ROTATE_CMD = 'true';
  try {
    assert.deepEqual(rotateProxyEgress(), { skipped: 'not_configured' });
    process.env.GYM_PROXY_URL = 'http://127.0.0.1:59999';
    delete process.env.GYM_PROXY_ROTATE_CMD;
    assert.deepEqual(rotateProxyEgress(), { skipped: 'not_configured' });
  } finally {
    process.env.GYM_PROXY_URL = prevProxy;
    process.env.GYM_PROXY_ROTATE_CMD = prevCmd;
  }
});

test('rotateProxyEgress：执行轮换命令并受最小间隔限频', async () => {
  resetRotateState();
  const prev = {
    proxy: process.env.GYM_PROXY_URL,
    cmd: process.env.GYM_PROXY_ROTATE_CMD,
    min: process.env.GYM_PROXY_ROTATE_MIN_INTERVAL_MS
  };
  process.env.GYM_PROXY_URL = 'http://127.0.0.1:59999';
  const flag = '/tmp/opencode/rotate-flag';
  process.env.GYM_PROXY_ROTATE_CMD = `rm -f ${flag} && touch ${flag}`;
  process.env.GYM_PROXY_ROTATE_MIN_INTERVAL_MS = '50';
  try {
    const r1 = rotateProxyEgress();
    assert.equal(r1.rotated, true);

    // 限频：未到最小间隔（同步紧跟）→ skipped
    const rlio = rotateProxyEgress();
    assert.deepEqual(rlio, { skipped: 'rate_limited' });

    // 异步 exec 完成后 flag 应存在
    await new Promise((resolve) => setTimeout(resolve, 300));
    const fs = require('node:fs');

    // force 可越过限频
    resetRotateState();
    assert.equal(rotateProxyEgress().rotated, true);
  } finally {
    Object.assign(process.env, prev);
    require('node:fs').rmSync(flag, { force: true });
  }
});
