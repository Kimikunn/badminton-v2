/**
 * 外部场馆下单接口封装（川沙体育中心小程序）— 自动锁场链路
 *
 * 接口链（HAR 取证，见 .trellis/tasks/08-29-auto-order/prd.md）：
 *   createOrderCheck → createOrder → prePay → pay
 * 本模块只覆盖锁场所需的 createOrderCheck / createOrder（createOrder 是
 * 全链路唯一带 RSA-2048 签名的接口，签名头由 venueLockSigner 生成）。
 *
 * 接口路径与成功判定【已从小程序包反编译确认，见 services/api.js】：
 *   - POST /gym/miniprogram/areaOrder/createOrderCheck（无签名）
 *   - POST /gym/miniprogram/areaOrder/createOrder（带 X-Ca-* 签名头）
 *   - body 为 { venueSportId: 1, areaItems }，areaItems 直接透传
 *     listAreaLease 返回的原始 item 对象（小程序就是这么干的，
 *     见 bookingLockService.buildAreaItems）。
 *   - 成功判定：createOrder body.code === 200（429/403004 = 触发风控需验证码）；
 *     createOrderCheck 看 body.data.success === 'Y'（'N' = 冲突/不可订）；例外：
 *     data.success='N' 且 code=LIMITED_BY_START_TIME 是“距开场不足 12 小时不可退款”软提示，
 *     由 bookingLockService 决定不阻断下单。
 *
 * 凭证与 listAreaLease 一致：token-user 头来自 GYM_TOKEN_USER env
 * （经 intentService.getEnvConfig 实时读取）。token 只出现在请求头，
 * 绝不写日志。fetch 可注入（测试 stub 用，缺省用全局 fetch）。
 */
const intentService = require('./intentService');
const { signCreateOrder } = require('./venueLockSigner');
const venueHttp = require('./venueHttp');

const GYM_API_BASE = 'https://shop.chuanshatiyuchang.cn/gym/miniprogram';
const CREATE_ORDER_CHECK_URL = `${GYM_API_BASE}/areaOrder/createOrderCheck`;
const CREATE_ORDER_URL = `${GYM_API_BASE}/areaOrder/createOrder`;
const FETCH_TIMEOUT_MS = 15000;

function baseHeaders(tokenUser) {
  return {
    'token-user': tokenUser,
    'x-gym-client-id': '1',
    'content-type': 'application/json'
  };
}

/** POST JSON；网络异常 / 超时抛出，HTTP 或业务码不抛出（由调用方检查 body.code） */
async function postJson(url, body, { extraHeaders = {} } = {}) {
  const tokenUser = intentService.getEnvConfig().tokenUser;
  if (!tokenUser) throw new Error('小程序 token 未配置（GYM_TOKEN_USER）');

  const bodyText = JSON.stringify(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await venueHttp.venueFetch(url, {
      method: 'POST',
      headers: { ...baseHeaders(tokenUser), ...extraHeaders },
      body: bodyText,
      signal: controller.signal
    });
    const respBody = await resp.json().catch(() => null);
    return { httpOk: resp.ok, status: resp.status, body: respBody };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 下单前校验（无签名）。
 * @param {Array} areaItems 见 bookingLockService.buildAreaItems
 */
function createOrderCheck(areaItems, options = {}) {
  return postJson(CREATE_ORDER_CHECK_URL, { venueSportId: 1, areaItems }, options);
}

/**
 * 下单锁场（带 X-Ca-* 签名头）。
 * @throws {SignNotConfiguredError} 签名私钥未配置时抛出（由 bookingLockService 捕获降级）
 */
async function createOrder(areaItems, options = {}) {
  const body = { venueSportId: 1, areaItems };
  const { timestamp, nonce, signature } = signCreateOrder();
  return postJson(CREATE_ORDER_URL, body, {
    ...options,
    extraHeaders: {
      'X-Ca-Timestamp': timestamp,
      'X-Ca-Nonce': nonce,
      'X-Ca-Signature': signature
    }
  });
}

module.exports = { GYM_API_BASE, createOrderCheck, createOrder };
