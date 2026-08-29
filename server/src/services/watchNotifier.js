/**
 * 订场监控推送（watchNotifier） — 按 webhook 类型构造 payload
 *
 * 支持 wxpusher（默认，官方固定端点）/ pushplus（官方固定端点）/
 * wecom（群机器人 webhook）/ serverchan。
 * 任何失败（网络异常 / HTTP 非 2xx / 业务码非成功）都返回 { success: false, error }，
 * 绝不抛出，由调用方落 notifications 记录。
 *
 * 安全：token/url 属于敏感凭证，本模块不打日志。
 */

const PUSHPLUS_ENDPOINT = 'https://www.pushplus.plus/send';
const WXPUSHER_ENDPOINT = 'https://wxpusher.zjiecode.com/api/send/message';
const NOTIFY_TIMEOUT_MS = 15000;

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await resp.json().catch(() => null);
    return { httpOk: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function fail(message) {
  return { success: false, error: message };
}

async function notifyPushplus({ token, topic, title, content }) {
  if (!token) return fail('pushplus token 未配置');
  const body = { token, title, content, template: 'markdown' };
  if (topic) body.topic = topic;
  const resp = await postJson(PUSHPLUS_ENDPOINT, body);
  if (resp.httpOk && resp.data && resp.data.code === 200) return { success: true };
  const msg = (resp.data && (resp.data.msg || resp.data.message)) || `HTTP ${resp.status}`;
  return fail(`pushplus 推送失败：${msg}`);
}

async function notifyWecom({ url, content }) {
  if (!url) return fail('企业微信 webhook 地址未配置');
  const resp = await postJson(url, { msgtype: 'markdown', markdown: { content } });
  if (resp.httpOk && resp.data && resp.data.errcode === 0) return { success: true };
  const msg = (resp.data && resp.data.errmsg) || `HTTP ${resp.status}`;
  return fail(`企业微信推送失败：${msg}`);
}

async function notifyWxpusher({ token, topic, title, content }) {
  if (!token) return fail('wxpusher appToken 未配置');
  const topicId = parseInt(topic, 10);
  if (!Number.isInteger(topicId)) return fail('wxpusher Topic ID 未配置');
  // contentType 3 = markdown，summary 为通知栏标题；只支持 Topic 群发
  const body = { appToken: token, content, summary: title, contentType: 3, topicIds: [topicId] };
  const resp = await postJson(WXPUSHER_ENDPOINT, body);
  if (resp.httpOk && resp.data && resp.data.code === 1000) return { success: true };
  const msg = (resp.data && resp.data.msg) || `HTTP ${resp.status}`;
  return fail(`wxpusher 推送失败：${msg}`);
}

async function notifyServerchan({ url, title, content }) {
  if (!url) return fail('Server酱 webhook 地址未配置');
  const resp = await postJson(url, { title, desp: content });
  if (resp.httpOk && resp.data && resp.data.code === 0) return { success: true };
  const msg = (resp.data && (resp.data.message || resp.data.errmsg)) || `HTTP ${resp.status}`;
  return fail(`Server酱推送失败：${msg}`);
}

/**
 * @param {{ type: string, url?: string, token?: string, topic?: string, title: string, content: string }} opts
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function notify(opts) {
  try {
    switch (opts.type) {
      case 'wxpusher':
        return await notifyWxpusher(opts);
      case 'pushplus':
        return await notifyPushplus(opts);
      case 'wecom':
        return await notifyWecom(opts);
      case 'serverchan':
        return await notifyServerchan(opts);
      default:
        return fail(`不支持的推送类型：${opts.type}`);
    }
  } catch (err) {
    // 网络错误 / 超时等，吞掉并转为失败结果（err.message 不含凭证）
    return fail(err.name === 'AbortError' ? '推送请求超时' : `推送请求异常：${err.message}`);
  }
}

module.exports = { notify, PUSHPLUS_ENDPOINT, WXPUSHER_ENDPOINT };
