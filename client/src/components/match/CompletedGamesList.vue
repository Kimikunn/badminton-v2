<script setup>
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'

defineProps({
  games: { type: Array, default: () => [] },
  hasCurrentGame: { type: Boolean, default: false },
  isMatchOver: { type: Boolean, default: false },
  getRuleEventBadges: { type: Function, required: true }
})

const emit = defineEmits(['edit-game', 'revert-last'])
</script>

<template>
  <Card v-if="games.length > 0" padding="sm">
    <div class="flex gap-2 overflow-x-auto pb-1 items-start">
      <div
        v-for="game in games"
        :key="game.id"
        class="flex flex-col items-center p-2 px-3 rounded-lg min-w-[82px] cursor-pointer transition-transform duration-fast active:scale-95"
        :class="{
          'border border-accent bg-accent-subtle': game.winner === 'a',
          'border border-danger bg-danger-subtle': game.winner === 'b',
          'border border-line-light bg-canvas': game.winner !== 'a' && game.winner !== 'b'
        }"
        @click="emit('edit-game', game)"
      >
        <span class="text-xs text-fg-muted font-medium">G{{ game.gameNo }}</span>
        <span class="text-sm font-semibold text-fg">{{ game.scoreA }}:{{ game.scoreB }}</span>
        <div v-if="getRuleEventBadges(game).length" class="mt-1 flex flex-col items-center gap-1">
          <Badge
            v-for="badge in getRuleEventBadges(game)"
            :key="badge.id"
            :variant="badge.variant"
            size="sm"
          >
            {{ badge.label }}
          </Badge>
        </div>
      </div>

      <div
        v-if="hasCurrentGame && !isMatchOver"
        class="flex flex-col items-center p-2 px-3 rounded-sm min-w-[68px] whitespace-nowrap border border-dashed border-line-light opacity-60"
      >
        <span class="text-xs text-fg-muted font-medium">G{{ games.length + 1 }}</span>
        <span class="text-sm font-semibold text-fg">进行中</span>
      </div>
    </div>

    <Button
      v-if="games.length > 0"
      variant="ghost"
      size="sm"
      class="mt-2 !text-2xs"
      @click="emit('revert-last')"
    >
      ↩ 撤回最后一局
    </Button>
  </Card>
</template>
