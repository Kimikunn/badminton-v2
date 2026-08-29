-- 014: 自动锁场数量限制 — 监控目标新增 max_locks_per_slot（每时段最多锁几片，默认 1）
-- poller 按 startTime|endTime 分组，每组最多锁 max_locks_per_slot 片；
-- 锁场冲突（别人抢先订走）时按偏好顺序自动递补下一片，直到锁够数量。
-- 注意：schema.sql 已对新库直接创建该列，本文件由 db.js 的
-- migrateVenueLockMaxPerSlot() 特判执行（带 hasColumn 幂等判断），
-- 此处 SQL 仅作迁移内容记录，不会被原样执行。
ALTER TABLE venue_watch_targets ADD COLUMN max_locks_per_slot INTEGER NOT NULL DEFAULT 1;
