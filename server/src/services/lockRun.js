/**
 * 锁场满足判定 — 无 IO 纯函数（无 DB 依赖）
 *
 * 从 bookingLockService 抽出，由 bookingLockService（引擎锁场）与 intentService
 * （状态派生）共用：避免"整段满足"两处实现漂移，也避免两个 service 互相 require
 * 形成环（bookingLockService 已 require intentService）。
 *
 * - findRun：在 hourMap 中找一段连续 duration_hours 小时、每小时可锁数
 *   （当前可订 + 我已锁）≥ courts_needed 的小时段；多候选按最早开始取一段。
 * - isOccurrenceFulfilled：只按"已锁到"的记录判定（locked-only），等价于原
 *   occurrenceFulfilled()（buildHourMap(intent, date, []) + findRun）。
 */
const { hhmmToMinutes } = require('./venueShared');

/**
 * 在 hourMap 中找一段连续 duration_hours 小时、每小时可锁数
 * （当前可订 + 我已锁）≥ courts_needed 的小时段。
 * 多候选时按最早开始取一段；返回按开始时间排序的小时数组或 null。
 */
function findRun(hourMap, intent) {
  const hours = [...hourMap.values()].sort((a, b) => a.startMin - b.startMin);
  let run = [];
  for (const hour of hours) {
    const prev = run[run.length - 1];
    const consecutive = prev && prev.endMin === hour.startMin;
    const enough = (hour.available.length + hour.lockedCount) >= intent.courts_needed;
    run = consecutive && enough ? [...run, hour] : (enough ? [hour] : []);
    if (run.length >= intent.duration_hours) return run.slice(0, intent.duration_hours);
  }
  return null;
}

/**
 * 该次发生是否已满足：窗口内存在一段连续 duration_hours 小时、
 * 每小时 locked 数 ≥ courts_needed 的小时段（允许跨场地）。
 *
 * @param {object} intentRow booking_intents 行（读 window_start/window_end/duration_hours/courts_needed）
 * @param {object[]} lockedRows 该意图当天的已锁到记录（booking_intent_locks，status='locked'）；
 *   窗口外的记录不计入，非 locked 的行被忽略
 * @returns {boolean}
 */
function isOccurrenceFulfilled(intentRow, lockedRows) {
  const hourMap = new Map();
  for (const row of lockedRows || []) {
    if (row.status && row.status !== 'locked') continue;
    if (row.start_time < intentRow.window_start || row.end_time > intentRow.window_end) continue;
    if (!hourMap.has(row.start_time)) {
      hourMap.set(row.start_time, {
        startMin: hhmmToMinutes(row.start_time),
        endMin: hhmmToMinutes(row.end_time),
        available: [],
        lockedCount: 0
      });
    }
    hourMap.get(row.start_time).lockedCount += 1;
  }
  return !!findRun(hourMap, intentRow);
}

module.exports = { findRun, isOccurrenceFulfilled };
