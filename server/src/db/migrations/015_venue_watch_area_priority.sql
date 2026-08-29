-- 015: 全局场地优先级 + 监控失效告警标记
-- venue_watch_config 新增：
--   area_priority         TEXT    — 全局锁场场地优先级（JSON 有序 areaId 数组）；
--                                   目标自身 areaIds 为空时生效，空 = 按场馆返回顺序
--   poll_failure_notified INTEGER — 连续拉取失败告警去重标记（同 token_invalid_notified 模式）
-- 注意：schema.sql 已对新库直接创建该列，本文件由 db.js 的
-- migrateVenueWatchAreaPriority() 特判执行（带 hasColumn 幂等判断），
-- 此处 SQL 仅作迁移内容记录，不会被原样执行。
ALTER TABLE venue_watch_config ADD COLUMN area_priority TEXT;
ALTER TABLE venue_watch_config ADD COLUMN poll_failure_notified INTEGER NOT NULL DEFAULT 0;
