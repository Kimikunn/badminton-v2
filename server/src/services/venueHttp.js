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

// === 代理出口自动轮换（风控自愈） ===
// 场馆会临时封禁共享出口 IP（WARP/机房段），表现为整站 TCP 超时。
// 重启 WARP 容器即可换到出口池里的新 IP（已实测验证）：由 watchEngine 在
// "轮内全部日期拉取失败"时调用，每 GYM_PROXY_ROTATE_MIN_INTERVAL_MS 至多换一次。

const { exec } = require('child_process');
const logger = require('../utils/logger');

let lastRotateAt = 0;
let rotateCount = 0;
const ROTATE_CMD_TIMEOUT_MS = 60_000;

/**
 * 触发代理出口轮换（执行 GYM_PROXY_ROTATE_CMD，如 'docker restart badminton-warp'）。
 * 有速率限制：未到最小间隔返回 skipped，避免风控持续期间狂换 IP。
 * 尽力而为：命令失败只记日志，不抛出（告警链路不能被自愈动作打断）。
 */
function rotateProxyEgress({ force = false } = {}) {
  const cmd = process.env.GYM_PROXY_ROTATE_CMD;
  if (!process.env.GYM_PROXY_URL || !cmd) return { skipped: 'not_configured' };
  const minMs = Number(process.env.GYM_PROXY_ROTATE_MIN_INTERVAL_MS || 10 * 60_000);
  const now = Date.now();
  if (!force && now - lastRotateAt < minMs) return { skipped: 'rate_limited' };
  lastRotateAt = now;
  rotateCount += 1;
  // 换出口后丢弃旧连接，避免复用被拉黑 IP 的 keep-alive 连接
  proxyUrlLoaded = '';
  proxyAgent = null;
  exec(cmd, { timeout: ROTATE_CMD_TIMEOUT_MS }, (err) => {
    if (err) logger.error(`venueHttp.rotate - 出口轮换命令执行失败: ${err.message}`);
    else logger.info(`venueHttp.rotate - 代理出口已轮换（第 ${rotateCount} 次）`);
  });
  return { rotated: true, count: rotateCount };
}

/** 测试用：重置轮换状态 */
function resetRotateState() {
  lastRotateAt = 0;
  rotateCount = 0;
}

module.exports = { venueFetch, outboundDispatcher, paceOutbound, rotateProxyEgress, resetRotateState };
