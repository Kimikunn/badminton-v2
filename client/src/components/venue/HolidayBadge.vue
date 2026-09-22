<script setup>
import { HOLIDAY_TYPE_MARKS } from '@/utils/holiday'

/**
 * HolidayBadge — 法定假日「休」/ 调休补班「班」徽标
 *
 * 日历格子与 DaySheet 共用同一字形与配色，避免两处各写一套（type → 字形/颜色只有这里一处定义）。
 * 消费方的定位类（如格子的 `.holiday-mark`、面板的 `.holiday-chip`）仍由调用处传入。
 *
 * @props {string} type - 'holiday'（休，danger 色）| 'workday'（班，中性色），来自 holidayFor()
 * @props {string} size - xs：格子左上角 8px 纯文字 | md：DaySheet 20px 圆角色块
 */
defineProps({
  type: { type: String, required: true },
  size: { type: String, default: 'md', validator: v => ['xs', 'md'].includes(v) }
})
</script>

<template>
  <span
    class="flex items-center justify-center font-semibold"
    :class="size === 'xs'
      ? ['text-[8px] leading-[9px]', type === 'holiday' ? 'text-danger' : 'text-fg-muted']
      : ['w-5 h-5 rounded-md text-2xs text-fg-inverse shrink-0', type === 'holiday' ? 'bg-danger' : 'bg-fg-muted']"
  >{{ HOLIDAY_TYPE_MARKS[type] }}</span>
</template>
