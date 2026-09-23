/**
 * 场馆出站 HTTP 公共层 —— 所有访问场馆接口（shop.chuanshatiyuchang.cn）的
 * fetch 统一从这里走，集中两件事：
 *
 * 1. 代理出口（绕 IP 风控）：配置 GYM_PROXY_URL 后（如 http://warp-gost:8080，
 *    WARP 链路见 docker-compose.yml 的 warp/warp-gost 服务），请求经
 *    undici ProxyAgent 走代理出口，主服务器 IP 不再直连场馆。
 *    未配置时行为与原生 fetch 完全一致。
 * 2. 出站礼貌间隔：外部调用方用 paceOutbound() 在多次拉取之间加随机间隔，
 *    避免密频请求再次触发风控。
 */
const { ProxyAgent } = require('undici');

let proxyAgent = null;
let proxyUrlLoaded = '';

/** 当前出站 dispatcher（GYM_PROXY_URL 未配置 → undefined，直连） */
function outboundDispatcher() {
  const url = process.env.GYM_PROXY_URL;
  if (!url) return undefined;
  if (!proxyAgent || proxyUrlLoaded !== url) {
    proxyAgent = new ProxyAgent({
      uri: url,
      connections: 4,          // 复用少量长连接，降低握手与指纹暴露
      keepAliveTimeout: 10_000,
      requestTls: { timeout: 15_000 }
    });
    proxyUrlLoaded = url;
  }
  return proxyAgent;
}

/**
 * 场馆接口专用 fetch：与全局 fetch 同签名，额外合入代理 dispatcher。
 * 不改 method/headers/timeout 语义；dispatcher 字段不被 Node 原生 fetch 之外的
 * stub 识别也无害（测试用 stubFetch 注入的假 fetch 会忽略未知字段）。
 */
function venueFetch(url, options = {}) {
  const dispatcher = outboundDispatcher();
  return fetch(url, dispatcher ? { ...options, dispatcher } : options);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 出站礼貌间隔区间（毫秒）：每次调用时读 env，测试可动态置 0 关闭 */
function outboundSpacing() {
  const min = Number(process.env.GYM_OUTBOUND_SPACING_MIN_MS ?? 1500);
  const max = Number(process.env.GYM_OUTBOUND_SPACING_MAX_MS ?? 3500);
  if (max <= 0) return 0;
  return min + Math.random() * Math.max(0, max - min);
}

/** 出站礼貌间隔：连续外呼之间随机 sleep，避免密频请求再触发风控 */
async function paceOutbound() {
  const ms = outboundSpacing();
  if (ms > 0) await sleep(ms);
}

module.exports = { venueFetch, outboundDispatcher, paceOutbound };
