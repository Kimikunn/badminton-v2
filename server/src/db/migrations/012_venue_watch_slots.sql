-- 012: 监控目标新增离散时段列表 slots（JSON 数组 [{startTime, endTime}]）
-- NULL = 不限制，维持 start_time/end_time 整区间语义（兼容旧数据）；
-- 非空时 poller 按 slot 精确匹配，start_time/end_time 仅作边界展示。
-- 注意：schema.sql 已对新库直接创建该列，本文件由 db.js 的
-- migrateVenueWatchSlots() 特判执行（带 hasColumn 幂等判断），
-- 此处 SQL 仅作迁移内容记录，不会被原样执行。
ALTER TABLE venue_watch_targets ADD COLUMN slots TEXT;
