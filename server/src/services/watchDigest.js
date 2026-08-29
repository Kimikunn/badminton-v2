/**
 * 订场监控 — 每日场次汇总（digest）排版与变更提醒标题
 *
 * - buildDigest(env, fetchAreaLease)：拉取今天起放票窗口内（BOOKING_WINDOW_DAYS 天）
 *   的可订数据，按日期分节排版为 markdown，由引擎每日固定时刻触发推送
 * - buildNotifyTitle(date, slots)：引擎变更提醒的标题（含日期与场地短名）
 *
 * fetchAreaLease 由调用方（引擎）注入，避免与引擎循环依赖。
 */
const { BOOKING_WINDOW_DAYS, dateStr, isSlotAvailable } = require('./venueShared');

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 8/31 */
function mdLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 周一 */
function weekdayLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  return `周${WEEKDAY_NAMES[d.getDay()]}`;
}

/** 场地名精简：去掉括号及内容，如"一号场(3F)"→"一号场" */
function courtShort(areaName) {
  return String(areaName || '').replace(/[（(][^)）]*[)）]/g, '').trim();
}

/**
 * 场地列表排版：全部可订 → "全部N片可订"；超过 4 片 → 前 3 个 + " 等N片"；否则全列
 */
function formatCourts(courts, totalAreas) {
  if (totalAreas > 0 && courts.length === totalAreas) return `全部${totalAreas}片可订`;
  if (courts.length > 4) return `${courts.slice(0, 3).join('/')} 等${courts.length}片`;
  return courts.join('/');
}

/** 单日期分节：{ text, hasAvailable } */
function buildSection(date, data) {
  const areas = (data && data.areas) || [];
  const totalAreas = areas.length;
  const buckets = new Map(); // 'HH:MM-HH:MM' → Set(场地短名)
  for (const area of areas) {
    for (const item of area.items || []) {
      if (!isSlotAvailable(item)) continue;
      const key = `${item.startTime}-${item.endTime}`;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key).add(courtShort(area.areaName) || '场地');
    }
  }
  const lines = [...buckets.keys()].sort().map(key => {
    const courts = [...buckets.get(key)];
    return `${key} ${formatCourts(courts, totalAreas)}`;
  });
  return {
    text: `**${mdLabel(date)} ${weekdayLabel(date)}**\n${lines.length ? lines.join('\n') : '暂无可订'}`,
    hasAvailable: lines.length > 0
  };
}

/**
 * 拉取放票窗口内各日可订数据并排版。
 * @param {{ tokenUser: string }} env
 * @param {(date: string, tokenUser: string) => Promise<object>} fetchAreaLease 引擎注入
 * @returns {Promise<{ title: string, content: string } | { error: 'token_invalid' | 'upstream', date?: string }>}
 */
async function buildDigest(env, fetchAreaLease) {
  const days = [];
  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(dateStr(d));
  }

  const sections = [];
  const availableLabels = [];
  for (const date of days) {
    let resp;
    try {
      resp = await fetchAreaLease(date, env.tokenUser);
    } catch {
      return { error: 'upstream', date };
    }
    if (resp.body && resp.body.code === 401) return { error: 'token_invalid', date };
    if (!resp.httpOk || !resp.body || !resp.body.data) return { error: 'upstream', date };

    const section = buildSection(date, resp.body.data);
    sections.push(section.text);
    if (section.hasAvailable) availableLabels.push(`${weekdayLabel(date)}${mdLabel(date)}`);
  }

  const title = availableLabels.length
    ? `场次汇总： ${availableLabels.join('、')} 有可订`
    : `近${BOOKING_WINDOW_DAYS}天暂无可订场次`;
  return { title, content: sections.join('\n\n') };
}

/**
 * 变更提醒标题：
 * - 单 slot：`8/31 周一 一号场 19:00-20:00 可订`
 * - 多 slot：场地短名去重，前 3 个（超过 3 片追加" 等N片"）：`8/31 周一 一号场/二号场 可订`
 */
function buildNotifyTitle(date, slots) {
  const prefix = `${mdLabel(date)} ${weekdayLabel(date)}`;
  if (slots.length === 1) {
    const s = slots[0];
    return `${prefix} ${courtShort(s.areaName) || '场地'} ${s.startTime}-${s.endTime} 可订`;
  }
  const courts = [...new Set(slots.map(s => courtShort(s.areaName) || '场地'))];
  const shown = courts.length > 3 ? `${courts.slice(0, 3).join('/')} 等${courts.length}片` : courts.join('/');
  return `${prefix} ${shown} 可订`;
}

module.exports = { courtShort, buildDigest, buildNotifyTitle };
