<script setup>
import { ref, watch } from 'vue'
import Sheet from '@/components/ui/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { useAdminTokenPrompt } from '@/composables/useAdminTokenPrompt'

const { adminTokenPromptState, submitAdminToken, cancelAdminToken } = useAdminTokenPrompt()
const token = ref('')

watch(() => adminTokenPromptState.show, (show) => {
  if (show) token.value = ''
})

function submit() {
  submitAdminToken(token.value)
}
</script>

<template>
  <Sheet :show="adminTokenPromptState.show" :title="adminTokenPromptState.title" @close="cancelAdminToken">
    <form class="token-body" @submit.prevent="submit">
      <p class="token-message">{{ adminTokenPromptState.message }}</p>
      <Input
        v-model="token"
        label="权限令牌"
        type="password"
        placeholder="输入 admin token"
        autocomplete="current-password"
        autofocus
      />
      <p class="token-hint">令牌只会保存在当前设备的浏览器本地存储中，可在之后的设置中清除。</p>
      <div class="token-actions">
        <Button variant="secondary" size="md" @click="cancelAdminToken">取消</Button>
        <Button variant="primary" size="md" :disabled="!token.trim()" @click="submit">保存并重试</Button>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
@reference "@/styles/global.css";

.token-body { @apply flex flex-col gap-4; }
.token-message { @apply text-sm leading-relaxed text-fg-secondary; }
.token-hint { @apply text-xs leading-relaxed text-fg-muted; }
.token-actions { @apply grid grid-cols-2 gap-3; }
</style>
