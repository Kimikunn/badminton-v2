/**
 * 订场领域公共 helper — 日期格式化 / slot 可订判定 / 放票窗口常量
 *
 * 收编原监控各模块复制粘贴的 dateStr、isSlotAvailable 等，全仓只此一份。
 */

// 场馆放票窗口：今天起 4 天（今天~第 4 天，每天 09:00 滚动放第 4 天的票，见 CONTEXT.md）
const BOOKING_WINDOW_DAYS = 4;

// 每天 09:00:00 放新放票日的票（引擎 burst 与意图状态派生的 pending_release 共用同一常量）
const RUSH_HOUR = 9;

/** Date → 'YYYY-MM-DD'（本地时区） */
function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today() {
  return dateStr(new Date());
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}

/** 'HH:MM' → 分钟数（窗口/时长计算用） */
function hhmmToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 外部 listAreaLease item 的可订判定（status/showStatus 双重确认） */
function isSlotAvailable(item) {
  return !!(item && item.status === 'NORMAL' && item.showStatus === 'AVAILABLE');
}

module.exports = { BOOKING_WINDOW_DAYS, RUSH_HOUR, dateStr, today, yesterday, hhmmToMinutes, isSlotAvailable };
