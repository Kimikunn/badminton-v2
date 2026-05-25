<script setup>
import Sheet from '@/components/ui/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import { useConfirm } from '@/composables/useConfirm'

const { confirmState, resolveConfirm, cancelConfirm } = useConfirm()
</script>

<template>
  <Sheet :show="confirmState.show" :title="confirmState.options.title" @close="cancelConfirm">
    <div class="confirm-body">
      <p class="confirm-message">{{ confirmState.options.message }}</p>
      <div class="confirm-actions">
        <Button variant="secondary" size="md" @click="cancelConfirm">
          {{ confirmState.options.cancelText }}
        </Button>
        <Button :variant="confirmState.options.variant" size="md" @click="resolveConfirm">
          {{ confirmState.options.confirmText }}
        </Button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
@reference "@/styles/global.css";

.confirm-body { @apply flex flex-col gap-5; }
.confirm-message { @apply text-sm leading-relaxed text-fg-secondary whitespace-pre-line; }
.confirm-actions { @apply grid grid-cols-2 gap-3; }
</style>
