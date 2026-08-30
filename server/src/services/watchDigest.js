/**
 * 订场监控 — 变更提醒标题排版
 *
 * buildNotifyTitle(date, slots)：引擎 0→1 可订提醒的标题（含日期与场地短名）。
 * 原每日场次汇总（digest）推送已按用户反馈移除（2026-08-30：不需要全量汇总，
 * 只保留按意图的精准通知）。
 */
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

module.exports = { courtShort, buildNotifyTitle };
