/**
 * 订场意图/监控引擎测试共享基建
 *
 * - global.fetch stub：installFetchStub/stubFetch 注入处理器，未注入时抛错，
 *   保证测试绝不访问真实外网（gym API 与推送 webhook 都走这里）
 * - 响应工厂：mockJsonResponse / slot / leaseResponse / multiAreaLease
 * - 路由分发：leaseAndPushFetch（取数 + 推送）、lockFlowFetch（取数 + 下单 + 推送）
 * - env 配置：configureEnv（GYM token + pushplus 推送 + 可选 RSA 签名私钥）、clearEnv
 */
const crypto = require('node:crypto');
const { dateStr, today } = require('../../src/services/venueShared');

const ENV_KEYS = ['GYM_TOKEN_USER', 'PUSH_TYPE', 'PUSH_TOKEN', 'PUSH_TOPIC', 'PUSH_URL', 'POLL_INTERVAL_SEC', 'GYM_SIGN_PRIVATE_KEY'];

// 测试用 RSA-2048 密钥对（仅用于验证签名链路，与真实密钥无关）
const { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

let fetchHandler = null;
const realFetch = global.fetch;
const PUSH_CALLS = [];

function stubFetch(handler) {
  fetchHandler = handler;
}

function installFetchStub() {
  global.fetch = async (url, opts) => {
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(url, opts);
  };
}

function restoreFetch() {
  global.fetch = realFetch;
  fetchHandler = null;
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

/** GYM token + pushplus 推送；withKey=true 时再配签名私钥 */
function configureEnv({ withKey = false } = {}) {
  process.env.GYM_TOKEN_USER = 'wxtoken-secret-9999';
  process.env.PUSH_TYPE = 'pushplus';
  process.env.PUSH_TOKEN = 'pp-token-abcd1234';
  // 出站礼貌间隔关掉，保持用例快跑（间隔逻辑单独测）
  process.env.GYM_OUTBOUND_SPACING_MIN_MS = '0';
  process.env.GYM_OUTBOUND_SPACING_MAX_MS = '0';
  if (withKey) process.env.GYM_SIGN_PRIVATE_KEY = TEST_PRIVATE_KEY;
}

function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** 今天 + n 天的日期串 */
function datePlus(n) {
  return dateStr(daysFromToday(n));
}

function mockJsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

/** 与真实 listAreaLease item 同构（含 areaId/areaName，见小程序 pages/venueReservation） */
function slot(uniqNo, startTime, endTime, { available = true, price = 60, areaId = 41, areaName = '1号场' } = {}) {
  return {
    uniqNo,
    areaId,
    areaName,
    startTime,
    endTime,
    price,
    status: 'NORMAL',
    showStatus: available ? 'AVAILABLE' : 'LOCKED'
  };
}

function leaseResponse(slots, { areaId = 41, areaName = '1号场', date = today() } = {}) {
  return mockJsonResponse({
    code: 0,
    data: { areaDate: date, areas: [{ areaId, areaName, items: slots }] }
  });
}

/** 多场地可订响应：entries = [{ areaId, areaName, slots }] */
function multiAreaLease(entries, { date = today() } = {}) {
  return mockJsonResponse({
    code: 0,
    data: { areaDate: date, areas: entries.map(e => ({ areaId: e.areaId, areaName: e.areaName, items: e.slots || [] })) }
  });
}

/** 空数据响应（某日尚未放票 / 无场地） */
function emptyLease(date = today()) {
  return mockJsonResponse({ code: 0, data: { areaDate: date, areas: [] } });
}

/**
 * 标准 fetch 路由：listAreaLease → leaseHandler；其余视为推送端点，记录 body 到
 * PUSH_CALLS 并默认 pushplus 成功。
 */
function leaseAndPushFetch(leaseHandler) {
  const leaseCalls = [];
  const handler = async (url, opts = {}) => {
    if (String(url).includes('listAreaLease')) {
      leaseCalls.push({ url: String(url), headers: opts.headers });
      return leaseHandler(url, opts);
    }
    PUSH_CALLS.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    return mockJsonResponse({ code: 200, msg: 'ok' });
  };
  handler.leaseCalls = leaseCalls;
  return handler;
}

/**
 * 锁场链路路由：listAreaLease / createOrderCheck / createOrder / 推送端点。
 * orderCalls 记录下单请求（kind: 'check' | 'create'，含 headers 与解析后的 body）。
 * checkBody/createBody 可以是对象，也可以是 (parsedBody) => body 函数。
 */
function lockFlowFetch({
  leaseHandler = () => leaseResponse([]),
  checkBody = { code: 200, data: { success: 'Y' } },
  createBody = { code: 200, data: { areaOrderId: 'ORD-123' } }
} = {}) {
  const orderCalls = [];
  const handler = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('listAreaLease')) return leaseHandler(url, opts);
    if (u.includes('createOrderCheck')) {
      const parsed = JSON.parse(opts.body);
      orderCalls.push({ kind: 'check', url: u, headers: opts.headers, body: parsed });
      return mockJsonResponse(typeof checkBody === 'function' ? checkBody(parsed) : checkBody);
    }
    if (u.includes('createOrder')) {
      const parsed = JSON.parse(opts.body);
      orderCalls.push({ kind: 'create', url: u, headers: opts.headers, body: parsed });
      return mockJsonResponse(typeof createBody === 'function' ? createBody(parsed) : createBody);
    }
    PUSH_CALLS.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
    return mockJsonResponse({ code: 200, msg: 'ok' });
  };
  handler.orderCalls = orderCalls;
  return handler;
}

module.exports = {
  ENV_KEYS,
  TEST_PUBLIC_KEY,
  TEST_PRIVATE_KEY,
  PUSH_CALLS,
  stubFetch,
  installFetchStub,
  restoreFetch,
  clearEnv,
  configureEnv,
  daysFromToday,
  datePlus,
  mockJsonResponse,
  slot,
  leaseResponse,
  multiAreaLease,
  emptyLease,
  leaseAndPushFetch,
  lockFlowFetch
};
