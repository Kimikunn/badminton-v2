# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [2.1.1] - 2026-05-27

### Added
- 场地分时段定价：`hourly_rate` 升级为 `pricing` JSON，支持工作日/周末分时段费率
- 订场月历视图：展示已订记录，点击未来日期可快速新增订场
- 赛季创建功能上线生产环境，预设管理器限制仅显示下一个可创建赛季
- 后端状态机双向补全：支持游戏撤回 → match → round → season 级联回退
- `state-machine.test.js`：13 个 table-driven 测试覆盖全部状态转换

### Changed
- 场地时间字段 `time TEXT` 拆分为 `start_time` + `end_time`，编辑表单改用 select
- 费用计算改为按 `rate × 小时数` 自动匹配，新增/编辑均生效
- PA7 赛制记分规则改用 `bestOf` 替代 `winsNeeded`
- S5 赛季默认轮次从 10 调整为 9
- 赛季命名统一为 `S{n}-{名称}` 格式，S2 颜色改为红色
- 页面 API 调用全部收敛至 Store 方法（`matchesStore`/`seasonsStore`）
- `.env` 体系替代 scripts 内联变量，`vite.config.js` 按 mode 设置 `outDir`
- Dockerfile 新增 `BUILD_DIR` 构建参数，区分测试/生产构建
- 生产端口从 8089 迁移至 8088

### Fixed
- iPhone 刘海屏适配：PWA 顶部增加 `safe-area-inset-top`
- 创建赛季 Sheet 残留 `v-if="canCreateSeason"` 导致弹窗无法打开
- `CompletedGamesList` flex-stretch 导致卡片高度异常
- `matchesStore` 游戏操作后未刷新 `seasonsStore`
- 订场删除记录后回退 `current_person_index`

### Removed
- 已上线功能的灰度 feature flag（赛季创建等）
- 未使用的 `GUEST_PLAYER` 常量

## [2.0.0] - 2026-05-25

### Added
- 初始发布版本：俱乐部管理、赛季赛制、场地预订、记分系统
