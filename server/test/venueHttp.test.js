const test = require('node:test');
const assert = require('node:assert/strict');
const { venueFetch, paceOutbound } = require('../src/services/venueHttp');

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
