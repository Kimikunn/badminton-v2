-- 010: venue-watch v2 — 凭证迁出 DB（改走服务器 .env）；targets 支持每周模式与多场地
--
-- 1) config 行清空 v1 凭证/推送列值（列保留不删，代码不再读取）
-- 2) targets 表重建：date 改为可空（每周模式无单日日期），新增 weekdays / area_ids，
--    旧 area_id 迁入 area_ids（area_id 非空 → '[area_id]'，否则 '[]'）
-- 3) 新增 venue_watch_areas 场地名映射表（poller 拉取时顺带记录，供 areaNames 输出）
--
-- 纯 SQL 实现，对新库（schema.sql 已是新结构）与旧库均幂等安全。

UPDATE venue_watch_config
SET token_user = NULL,
    webhook_type = NULL,
    webhook_url = NULL,
    webhook_token = NULL,
    webhook_topic = NULL,
    poll_interval_sec = NULL
WHERE id = 1;

CREATE TABLE IF NOT EXISTS venue_watch_targets_new (
  id TEXT PRIMARY KEY,
  date TEXT,                 -- YYYY-MM-DD，单日模式；NULL = 每周模式
  weekdays TEXT,             -- JSON 数组 0-6（0=周日）；NULL = 单日模式
  start_time TEXT NOT NULL,  -- HH:MM
  end_time TEXT NOT NULL,    -- HH:MM
  area_id INTEGER,           -- v1 遗留，废弃保留
  area_name TEXT,            -- v1 遗留，废弃保留
  area_ids TEXT NOT NULL DEFAULT '[]',  -- JSON 数组，空 = 任意场地
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO venue_watch_targets_new
  (id, date, weekdays, start_time, end_time, area_id, area_name, area_ids, enabled, created_at, updated_at)
SELECT id, date, NULL, start_time, end_time, area_id, area_name,
  CASE WHEN area_id IS NOT NULL THEN '[' || area_id || ']' ELSE '[]' END,
  enabled, created_at, updated_at
FROM venue_watch_targets;

DROP TABLE venue_watch_targets;
ALTER TABLE venue_watch_targets_new RENAME TO venue_watch_targets;

CREATE TABLE IF NOT EXISTS venue_watch_areas (
  area_id INTEGER PRIMARY KEY,
  area_name TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
