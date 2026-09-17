/**
 * lockRun — 锁场满足判定纯函数（无 DB）
 *
 * 覆盖「整段连续时长」的两条判定路径：findRun（可订+已锁）与
 * isOccurrenceFulfilled（locked-only，与 bookingLockService 旧行为等价）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const lockRun = require('../src/services/lockRun');
const { hhmmToMinutes } = require('../src/services/venueShared');

/** 意图行（snake_case，同 booking_intents） */
function intentRow(overrides = {}) {
  return {
    window_start: '17:00',
    window_end: '20:00',
    duration_hours: 2,
    courts_needed: 1,
    ...overrides
  };
}

/** 构造 hourMap：entries = [start, end, { available, locked }] */
function hourMap(...entries) {
  const map = new Map();
  for (const [start, end, counts = {}] of entries) {
    map.set(start, {
      startMin: hhmmToMinutes(start),
      endMin: hhmmToMinutes(end),
      available: Array.from({ length: counts.available || 0 }, (_, i) => ({ areaId: 41 + i })),
      lockedCount: counts.locked || 0
    });
  }
  return map;
}

/** booking_intent_locks 的已锁到行（判定只读 start_time/end_time） */
function lockRow(startTime, endTime, status = 'locked') {
  return { status, start_time: startTime, end_time: endTime };
}

// === findRun ===

test('findRun：连续两小时可订 → 取最早一段完整时长', () => {
  const map = hourMap(
    ['17:00', '18:00', { available: 1 }],
    ['18:00', '19:00', { available: 1 }],
    ['19:00', '20:00', { available: 1 }]
  );
  const run = lockRun.findRun(map, intentRow());
  assert.deepEqual(run.map(h => h.startMin), [17 * 60, 18 * 60]);
});

test('findRun：中间断开则不成段，取之后连续的候选', () => {
  const map = hourMap(
    ['17:00', '18:00', { available: 1 }],
    // 18-19 缺（不可订）
    ['19:00', '20:00', { available: 1 }],
    ['20:00', '21:00', { available: 1 }]
  );
  const run = lockRun.findRun(map, intentRow({ duration_hours: 2 }));
  assert.deepEqual(run.map(h => h.startMin), [19 * 60, 20 * 60]);
});

test('findRun：每小时可锁数不足 courts_needed 则不入段（可订 + 已锁合并计数）', () => {
  const map = hourMap(
    ['17:00', '18:00', { available: 1 }],
    ['18:00', '19:00', { available: 1, locked: 1 }]
  );
  // courts_needed=2：17-18 只有 1 片 → 不成段；18-19 有 1 可订 + 1 已锁 = 2 → 但只有一个小时，凑不齐 duration 2
  assert.equal(lockRun.findRun(map, intentRow({ courts_needed: 2 })), null);

  // 17-18 补上第 2 片后可订：两小时都满足 → 成段
  const enough = hourMap(
    ['17:00', '18:00', { available: 2 }],
    ['18:00', '19:00', { available: 1, locked: 1 }]
  );
  assert.equal(lockRun.findRun(enough, intentRow({ courts_needed: 2 })).length, 2);
});

test('findRun：duration 1 时取最早满足的一小时；空 map 返回 null', () => {
  const map = hourMap(
    ['18:00', '19:00', { available: 1 }],
    ['17:00', '18:00', { available: 0, locked: 1 }]
  );
  assert.deepEqual(lockRun.findRun(map, intentRow({ duration_hours: 1 })).map(h => h.startMin), [17 * 60]);
  assert.equal(lockRun.findRun(new Map(), intentRow()), null);
});

// === isOccurrenceFulfilled（locked-only，等价旧 behavior） ===

test('isOccurrenceFulfilled：连续 locked 凑齐整段为 true，缺一小时为 false', () => {
  const intent = intentRow();
  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('17:00', '18:00'),
    lockRow('18:00', '19:00')
  ]), true);

  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('17:00', '18:00'),
    lockRow('19:00', '20:00') // 18-19 断开
  ]), false);

  assert.equal(lockRun.isOccurrenceFulfilled(intent, []), false);
});

test('isOccurrenceFulfilled：courts_needed=2 时每小时需两条 locked 记录', () => {
  const intent = intentRow({ courts_needed: 2 });
  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('17:00', '18:00'), lockRow('17:00', '18:00'),
    lockRow('18:00', '19:00')
  ]), false);

  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('17:00', '18:00'), lockRow('17:00', '18:00'),
    lockRow('18:00', '19:00'), lockRow('18:00', '19:00')
  ]), true);
});

test('isOccurrenceFulfilled：窗口外的 locked 记录不计入（不满足段长）', () => {
  const intent = intentRow({ window_start: '17:00', window_end: '20:00', duration_hours: 2 });
  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('16:00', '17:00'),
    lockRow('17:00', '18:00')
  ]), false);

  // end_time 超出窗口同样被排除
  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('17:00', '18:00'),
    lockRow('19:00', '21:00')
  ]), false);
});

test('isOccurrenceFulfilled：非 locked 状态的记录被忽略（failed/expired 不占坑）', () => {
  const intent = intentRow();
  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    lockRow('17:00', '18:00', 'failed'),
    lockRow('17:00', '18:00', 'expired'),
    lockRow('18:00', '19:00')
  ]), false);

  // 无 status 字段的行按"已锁到"处理（兼容手工构造的行）
  assert.equal(lockRun.isOccurrenceFulfilled(intent, [
    { start_time: '17:00', end_time: '18:00' },
    { start_time: '18:00', end_time: '19:00' }
  ]), true);
});

test('isOccurrenceFulfilled：等价旧实现 buildHourMap(intent, date, []) + findRun', () => {
  // 旧实现：locked 行按 start_time 归并成 map（窗口外过滤 + lockedCount 累加），再 findRun
  function legacyOccurrenceFulfilled(intent, lockedRows) {
    const map = new Map();
    for (const row of lockedRows) {
      if (row.start_time < intent.window_start || row.end_time > intent.window_end) continue;
      if (!map.has(row.start_time)) {
        map.set(row.start_time, {
          startMin: hhmmToMinutes(row.start_time),
          endMin: hhmmToMinutes(row.end_time),
          available: [],
          lockedCount: 0
        });
      }
      map.get(row.start_time).lockedCount += 1;
    }
    return !!lockRun.findRun(map, intent);
  }

  const cases = [
    { intent: intentRow(), rows: [lockRow('17:00', '18:00'), lockRow('18:00', '19:00')] },
    { intent: intentRow(), rows: [lockRow('17:00', '18:00'), lockRow('18:00', '19:00'), lockRow('19:00', '20:00')] },
    { intent: intentRow({ courts_needed: 2 }), rows: [lockRow('17:00', '18:00'), lockRow('18:00', '19:00')] },
    { intent: intentRow({ duration_hours: 3 }), rows: [lockRow('17:00', '18:00'), lockRow('18:00', '19:00')] },
    { intent: intentRow(), rows: [lockRow('16:00', '17:00'), lockRow('18:00', '19:00')] },
    { intent: intentRow(), rows: [] }
  ];
  for (const { intent, rows } of cases) {
    assert.equal(
      lockRun.isOccurrenceFulfilled(intent, rows),
      legacyOccurrenceFulfilled(intent, rows),
      `intent ${JSON.stringify(intent)} rows ${JSON.stringify(rows)}`
    );
  }
});
