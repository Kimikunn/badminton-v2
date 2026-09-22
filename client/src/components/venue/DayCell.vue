<script setup>
/**
 * DayCell — 月历单日方块（卡片式）
 *
 * 一天的全部状态收在这一个组件里：今天（蓝方框）/ 不可用（红方块 + X）/
 * 休班角标 / 订场圆点 / 监控徽标。内部用固定锚点（角标左上、数字居中、
 * 圆点数字下方、徽标贴底内缩），任何状态组合都不出框、不互相挤动。
 *
 * @props {Object} cell - days computed 的一天：{ day, key, bookings, isToday, isPast, isUnavailable, monitor, holiday }
 * @events select - 点击可选日（非过去、非不可用）时上抛 YYYY-MM-DD
 */
import { X } from 'lucide-vue-next'
import { MONITOR_CELL_LABELS } from '@/stores/intent'
import HolidayBadge from '@/components/venue/HolidayBadge.vue'

defineProps({ cell: { type: Object, required: true } })
const emit = defineEmits(['select'])

// 徽标配色，与 Badge 的 variant 一一对应（配色约定见 design §4.4）
const MONITOR_PILL_CLASS = {
  awaiting_verify: 'bg-warning-subtle text-warning',
  fulfilled: 'bg-success-subtle text-success',
  watching: 'bg-accent-subtle text-accent',
  pending_release: 'bg-badge-blue-bg text-badge-blue',
  waiting: 'bg-badge-blue-bg text-badge-blue',
  paused: 'bg-surface-hover text-fg-muted',
}
</script>

<template>
  <div
    class="day-block"
    :data-date="cell.key"
    :class="{
      'day-today': cell.isToday && !cell.isUnavailable,
      'day-unavail': cell.isUnavailable,
      'day-past': cell.isPast && !cell.isUnavailable,
      'cursor-pointer active:scale-95 hover:shadow-md': !cell.isPast && !cell.isUnavailable,
    }"
    @click="!cell.isPast && !cell.isUnavailable && emit('select', cell.key)"
  >
    <template v-if="cell.isUnavailable">
      <X :size="16" class="x-mark" />
      <span class="day-number day-number-muted">{{ cell.day }}</span>
    </template>

    <template v-else>
      <HolidayBadge v-if="cell.holiday" :type="cell.holiday.type" size="xs" class="holiday-mark" />
      <!-- 维度一：当天监控条数（>1 才显示）；过去日不渲染 -->
      <span v-if="!cell.isPast && cell.monitor && cell.monitor.count > 1" class="monitor-count">{{ cell.monitor.count }}</span>
      <!-- 日期数字：固定居中，位置与角标/圆点/徽标无关 → 整月所有格子同一基线 -->
      <span class="day-number" :class="{ 'day-number-accent': cell.bookings.length }">{{ cell.day }}</span>
      <!-- 订场圆点：数字下方固定位置；有监控徽标时让位（徽标信息优先级更高） -->
      <span v-if="cell.bookings.length && !(cell.monitor && !cell.isPast)" class="day-dots">
        <span v-for="(b, j) in cell.bookings.slice(0, 3)" :key="j" class="day-dot" />
      </span>
      <span
        v-if="!cell.isPast && cell.monitor"
        class="monitor-pill"
        :class="MONITOR_PILL_CLASS[cell.monitor.status]"
      >{{ MONITOR_CELL_LABELS[cell.monitor.status] }}</span>
    </template>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

/* 日期方块：白底卡片 + 8px 小圆角 + 轻阴影；状态只叠加显示，不改尺寸与内容锚点 */
.day-block {
  @apply relative w-full aspect-square rounded-sm border border-line-light/60 bg-surface shadow-sm transition-[transform,box-shadow] duration-fast;
}
.day-past {
  @apply opacity-45 border-line-light/40 shadow-none;
}

/* 今天：蓝色方框用 inset 阴影画（不动 border 宽度 → 内容锚点与其它格子完全一致） */
.day-today {
  @apply border-accent;
  box-shadow: inset 0 0 0 2px var(--color-accent), var(--shadow-sm);
}

/* 不可用：红方块 + X */
.day-unavail {
  @apply border-danger/40 bg-danger-subtle shadow-none;
}

/* 休/班 角标：左上角 3px 内缩（8px 圆角内部的可用区域）；字形/配色由 HolidayBadge 统一 */
.holiday-mark {
  @apply absolute top-[3px] left-[3px] z-10;
}

/* 日期数字：固定位置（+1px 下移给左上角标留墨迹间隙），不被其它元素挤动 → 整月同一基线 */
.day-number {
  @apply absolute left-1/2 top-[calc(50%+1px)] -translate-x-1/2 -translate-y-1/2 text-sm leading-none text-fg-secondary;
}
.day-number-accent {
  @apply text-accent font-semibold;
}
.day-number-muted {
  @apply text-danger/50;
}

/* 订场圆点：数字行盒下方固定位置 */
.day-dots {
  @apply absolute left-1/2 -translate-x-1/2 flex gap-0.5;
  top: calc(50% + 9px);
}
.day-dot {
  @apply w-1.5 h-1.5 rounded-full shrink-0 bg-accent;
}

/* 监控徽标：胶囊贴底（胶囊底部是圆头，不会切到方块圆角）；满内宽避免「已暂停」被截断 */
.monitor-pill {
  @apply absolute bottom-0 left-1/2 -translate-x-1/2 max-w-full truncate rounded-full px-[3px] text-[9px] font-medium leading-[10px];
}

/* 条数角标：多条才显示，右上角；限高避免与居中数字相碰 */
.monitor-count {
  @apply absolute top-0.5 right-0.5 min-w-[11px] h-[11px] px-[3px] rounded-full bg-fg text-fg-inverse text-[8px] font-semibold leading-[11px] flex items-center justify-center;
}

.x-mark {
  @apply absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2;
  color: var(--color-danger);
  opacity: 0.55;
}
</style>
