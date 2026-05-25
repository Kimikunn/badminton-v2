<script setup>
import { ClipboardList, BarChart3, Trophy, Dumbbell, User, Award, Users, CircleHelp, CheckCircle, Pause } from 'lucide-vue-next'

/**
 * EmptyState — 空状态占位组件
 *
 * @props {string} icon - Lucide icon name or emoji string
 * @props {string} title - 标题
 * @props {string} description - 描述
 * @props {string} actionLabel - 操作按钮文字
 *
 * @slots icon - 自定义图标
 * @slots default - 替代 description 的自定义内容
 *
 * @events action - 操作按钮点击
 */
const iconMap = { ClipboardList, BarChart3, Trophy, Dumbbell, User, Award, Users, CircleHelp, CheckCircle, Pause,
  '🏸': Dumbbell, '📊': BarChart3, '📋': ClipboardList, '🏆': Trophy,
  '👤': User, '🎖': Award, '👥': Users, '❓': CircleHelp,
  '✅': CheckCircle, '⏸': Pause, '📍': CircleHelp }

const props = defineProps({
  icon: { type: String, default: '' },
  title: { type: String, default: '暂无数据' },
  description: { type: String, default: '' },
  actionLabel: { type: String, default: '' }
})

const iconComponent = computed(() => iconMap[props.icon] || ClipboardList)

import { computed } from 'vue'
defineEmits(['action'])
</script>

<template>
  <div class="flex flex-col items-center text-center py-12 px-4">
    <span class="block mb-4 text-fg-muted" v-if="$slots.icon"><slot name="icon"></slot></span>
    <component v-else :is="iconComponent" :size="48" class="block mb-4 text-fg-muted" />
    <h3 class="text-lg font-semibold text-fg mb-2">{{ title }}</h3>
    <p v-if="description && !$slots.default" class="text-sm text-fg-muted max-w-[260px] leading-relaxed">{{ description }}</p>
    <div v-if="$slots.default" class="mt-3">
      <slot></slot>
    </div>
    <button
      v-if="actionLabel"
      class="mt-5 px-5 py-2 border-none rounded-sm bg-accent text-fg-inverse text-sm font-medium cursor-pointer transition-colors duration-fast ease-out active:bg-accent-hover"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>
