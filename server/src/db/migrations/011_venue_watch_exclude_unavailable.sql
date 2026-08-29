-- 011: 监控目标新增"排除不可用日期"开关（默认开启）
-- 注意：schema.sql 已对新库直接创建该列，本文件由 db.js 的
-- migrateVenueWatchExcludeUnavailable() 特判执行（带 hasColumn 幂等判断），
-- 此处 SQL 仅作迁移内容记录，不会被原样执行。
ALTER TABLE venue_watch_targets ADD COLUMN exclude_unavailable INTEGER NOT NULL DEFAULT 1;
