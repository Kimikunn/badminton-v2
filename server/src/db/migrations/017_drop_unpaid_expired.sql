-- 017: 移除支付跟踪 —— booking_intent_locks 删 unpaid_expired_count 列
--
-- 行为变更（2026-08-30 用户决策）：锁场成功即视为成功，系统不再关心支付是否完成；
-- 两击降级/超时重锁逻辑整体移除。格子回流只做"已释放"记账（释放每日限订额度），
-- 不重锁、不推送。
--
-- 本文件仅作迁移内容记录，实际逻辑由 db.js 的 migrateDropUnpaidExpired() 执行
-- （hasColumn 幂等判断），此处 SQL 不会被原样执行。
ALTER TABLE booking_intent_locks DROP COLUMN unpaid_expired_count;
