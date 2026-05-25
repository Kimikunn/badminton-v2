<script setup>
import { Dice5 } from 'lucide-vue-next'
</script>

<template>
  <div class="p-4 flex flex-col items-center justify-center py-16 text-center">
    <Dice5 :size="48" class="text-accent mb-4" />
    <p class="text-lg font-semibold text-fg mb-2">规则面板</p>
    <p class="text-sm text-fg-muted">此页面将在后续迭代中开发</p>
  </div>
</template>
