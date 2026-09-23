<script setup>
/**
 * BookingRow — 一条订场记录行（VenueView 列表与 DaySheet 共用同一行排版）
 *
 * @props {Object} record - 订场记录（date/startTime/endTime/venueName/cost/notes）
 * @props {string} playerName - 玩家名
 * @props {string} playerAvatar - 玩家头像 URL（空则不显示头像）
 * @props {boolean} showDate - 左侧日期列（列表模式 true；DaySheet 已有面板标题，false）
 * @props {boolean} clickable - 整行可点（active 反馈 + click 事件）
 *
 * @slots trailing - 行尾操作区（如删除按钮）
 * @events click - clickable 时点击整行
 */
import Avatar from '@/components/ui/Avatar.vue'

defineProps({
  record: { type: Object, required: true },
  playerName: { type: String, default: '' },
  playerAvatar: { type: String, default: '' },
  showDate: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>

<template>
  <div class="flex items-center gap-2 py-2 border-b border-line-light last:border-b-0">
    <div
      class="flex-1 flex items-center gap-3 min-w-0"
      :class="{ 'cursor-pointer active:opacity-70': clickable }"
      @click="clickable && $emit('click')"
    >
      <div v-if="showDate" class="flex flex-col shrink-0 min-w-12">
        <span class="text-xs font-medium text-fg">{{ record.date?.slice(5) }}</span>
        <span class="text-2xs text-fg-muted">{{ record.startTime }}-{{ record.endTime }}</span>
      </div>
      <Avatar v-if="playerAvatar || playerName" :name="playerName" :src="playerAvatar" size="sm" />
      <div class="flex-1 min-w-0">
        <span class="block text-sm font-medium text-fg">{{ playerName }}</span>
        <span class="block text-xs text-fg-muted">{{ record.venueName || '—' }}<template v-if="!showDate"> · {{ record.startTime }}-{{ record.endTime }}</template></span>
        <span v-if="record.notes" class="block text-2xs text-warning">{{ record.notes }}</span>
      </div>
      <span class="text-sm font-semibold text-accent shrink-0">¥{{ record.cost }}</span>
    </div>
    <slot name="trailing"></slot>
  </div>
</template>
