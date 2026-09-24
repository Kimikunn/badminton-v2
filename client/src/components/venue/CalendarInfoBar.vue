<script setup>
/**
 * CalendarInfoBar — 订场日历底部信息栏（2026-09-23 第十二轮从 BookingCalendar 抽出复用）
 *
 * 结构：.infobar（flex justify-between）= 左 .items（日期填色图例，sw 色块）
 *     + 右 .items（监控色条图例，barleg 色条）+ .hours（当月总时长）。
 * 图例恒渲染、分组固定（左：今天/订场/不可用；右：监控中/待放票），
 * 内容由宿主以 props 传入，本组件不感知领域数据。
 *
 * 总时长恒显示（第十二轮）：hours=0 也渲染「0h」占位，右端布局不随数据增减跳动。
 *
 * 色值单一来源（跨组件）：待放票浅蓝 var(--cal-bar-waiting) 定义在宿主
 * BookingCalendar 的 .venue-calendar 根上（含 .dark 变体），本组件 barleg 经
 * CSS 变量继承引用同名 var，不在本组件重复定义色值；
 * 监控中深蓝直接用全局 token var(--color-badge-blue)。
 *
 * @props {Array} left - 日期填色图例 [{label, cls}]（cls 为 .sw 色块类，如 leg-today）
 * @props {Array} right - 监控色条图例 [{label, cls}]（cls 为 barleg 色条类，如 bar-watching）
 * @props {number} hours - 当月总时长（整数小时）
 */
defineProps({
  left: { type: Array, default: () => [] },
  right: { type: Array, default: () => [] },
  hours: { type: Number, default: 0 },
})
</script>

<template>
  <div class="infobar">
    <div class="items">
      <span v-for="item in left" :key="item.label" class="item">
        <span class="sw" :class="item.cls" />
        {{ item.label }}
      </span>
    </div>
    <div class="items">
      <span v-for="item in right" :key="item.label" class="item">
        <i class="barleg" :class="item.cls" />
        {{ item.label }}
      </span>
      <span class="hours">{{ hours }}h</span>
    </div>
  </div>
</template>

<style scoped>
/* 信息栏：左图例 | 右图例+总时长（恒渲染，0 显示 0h，右端不跳动） */
.infobar {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10px; padding: 8px 2px 0;
  font-size: 11px; color: var(--color-fg-muted);
}
.items { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.item { display: flex; align-items: center; gap: 5px; }
.sw { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; }
.barleg { width: 12px; height: 4px; border-radius: 2px; flex-shrink: 0; }

/* 日期填色图例（与 BookingCalendar 格子填色同 token） */
.leg-today { background: var(--color-accent); }
.leg-book { background: var(--color-success-subtle); }
.leg-unavail { background: var(--color-danger-subtle); }

/* 监控色条图例：barleg 与格内色条同色——watching=badge-blue 深蓝（全局 token）；
   waiting 引用宿主 .venue-calendar 根定义的 --cal-bar-waiting（单一事实来源，含 .dark 变体） */
.bar-watching { background: var(--color-badge-blue); }
.bar-waiting { background: var(--cal-bar-waiting); }

.hours { font-weight: 500; color: var(--color-fg-secondary); }
</style>
