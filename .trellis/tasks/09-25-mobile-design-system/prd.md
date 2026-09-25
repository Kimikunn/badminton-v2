# mobile-design-system

## Goal

为已上线的 Vue3 PWA（badminton client）建立"逐屏改版"的行动指南：冻结现状作为行为基线，
产出移动端设计系统 spec（`.trellis/spec/frontend/design-system.md`），并通过参考选型
（用户拍板）确定每个屏型的目标模式，供后续逐屏替换任务引用。

## Background

- 首次改版尝试（home-redesign-r1）无参考、无 spec 直接动手，产出后被回退。
- 结论：参照业界实践（freeze → spec → token 先行 → 逐屏替换 + 每屏回归）。
- 已有资产：tokens.css（完整 token 层）、e2e 72 项行为回归、screenshots.spec.js 逐屏截图、
  Sheet 组件（bottom sheet 模式）、内滚容器布局（规避 iOS 26 fixed bug，ADR 级契约）。

## Requirements

1. `design-system.md` spec：布局契约（app-shell/内滚/tabbar）、导航形态、触控目标、
   `:active` 约定、safe-area、glass 使用规则、组件清单 + 模式出处、每屏型配方（recipe）、
   逐屏替换工作流与回归清单。
2. 行为基线：逐屏截图（light/dark × 390/360）+ 关键交互清单存入任务目录 `baseline/`。
3. 参考选型材料：按屏型（tab 4 屏 + 详情页）列候选参考 app/模式与取舍说明，
   决策权在用户；AI 只负责调研、对比、辅助，最终选择由用户在对话中拍板。

## Acceptance Criteria

- [ ] `.trellis/spec/frontend/design-system.md` 完成并被 frontend/index.md 索引
- [ ] 每屏基线截图 + 交互清单入库
- [ ] 参考候选清单（按屏型）完成并提交用户选型
- [ ] 用户完成选型后，选型结果写回本 prd（Notes 区）作为后续逐屏任务的输入

## Notes

- 用户明确要求：参考选型阶段"把选择权交给用户"，AI 提供选项 + 分析 + 推荐，不代选。
- 逐屏替换不在本任务内，另开任务。
