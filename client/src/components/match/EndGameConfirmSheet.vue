<script setup>
import Button from '@/components/ui/Button.vue'

defineProps({
  show: { type: Boolean, default: false },
  scoreA: { type: Number, default: 0 },
  scoreB: { type: Number, default: 0 },
  winnerName: { type: String, default: '' },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'confirm'])
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="overlay" @click.self="emit('close')">
      <div class="sheet">
        <h3 class="text-lg font-semibold mb-2 text-fg">确认结束本局？</h3>
        <p class="text-sm text-fg-secondary mb-4">{{ scoreA }}:{{ scoreB }} · {{ winnerName }} 胜</p>
        <div class="flex gap-3">
          <Button variant="secondary" size="md" class="flex-1" @click="emit('close')">取消</Button>
          <Button variant="primary" size="md" class="flex-1" :loading="saving" @click="emit('confirm')">确认</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "@/styles/global.css";

.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
}

.sheet {
  @apply w-full max-w-[480px];
  background: var(--color-surface);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding: var(--space-6) var(--space-5) calc(var(--space-5) + var(--safe-bottom));
}

.sheet::before {
  content: '';
  display: block;
  width: 36px;
  height: 5px;
  border-radius: 9999px;
  background: var(--color-border);
  margin: 0 auto var(--space-4);
}
</style>
