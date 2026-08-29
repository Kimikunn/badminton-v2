-- 013: 自动锁场 — 监控目标新增 auto_lock 开关；新增锁场记录表 venue_lock_orders
-- auto_lock=1 的目标命中可订 slot 时，poller 自动调外部 createOrder 下单锁场
-- （未支付订单约 5 分钟自动过期），结果落 venue_lock_orders。
-- uniq_no 唯一索引用于去重：同一 slot 只锁一次（与 venue_watch_slot_state 同键）。
-- 注意：schema.sql 已对新库直接创建该列与该表，本文件由 db.js 的
-- migrateVenueLockOrders() 特判执行（带 hasColumn 幂等判断），
-- 此处 SQL 仅作迁移内容记录，不会被原样执行。
ALTER TABLE venue_watch_targets ADD COLUMN auto_lock INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS venue_lock_orders (
  id TEXT PRIMARY KEY,          -- vlo- 前缀
  target_id TEXT NOT NULL,      -- 触发锁场的监控目标
  uniq_no TEXT NOT NULL,        -- slot 唯一标识（同 venue_watch_slot_state），唯一索引去重
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  area_id INTEGER,
  area_name TEXT,
  order_id TEXT,                -- 外部订单号；失败时为空
  status TEXT NOT NULL,         -- locked | failed
  error TEXT,                   -- 失败原因；成功时为空
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_lock_orders_uniq_no ON venue_lock_orders(uniq_no);
