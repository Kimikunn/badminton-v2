<script setup>
import { ref } from 'vue'
import { FlaskConical, RotateCcw } from 'lucide-vue-next'
import Sheet from '@/components/ui/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import { api } from '@/api/client'
import { useAppInit } from '@/composables/useAppInit'
import { useToast } from '@/composables/useToast'

defineProps({
  show: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

const toast = useToast()
const { initAllStores } = useAppInit()
const resetting = ref(false)

async function resetTestData() {
  resetting.value = true
  try {
    const res = await api.post('/admin/reset-db', {})
    toast.show(res.data?.message || '数据已重置', 'success')
    await initAllStores({ force: true })
    emit('close')
  } catch (error) {
    toast.show(error.message || '重置失败', 'error')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Sheet :show="show" title="测试工具" height="auto" @close="emit('close')">
    <div class="space-y-5">
      <div class="flex items-start gap-3 rounded-xl border border-warning/20 bg-warning-subtle p-3">
        <FlaskConical :size="18" class="text-warning shrink-0 mt-0.5" />
        <div>
          <p class="text-sm font-medium text-warning mb-1">恢复生产数据</p>
          <p class="text-xs text-fg-muted leading-relaxed">
            将测试数据库重置为当前生产数据副本。此操作不可撤销。
          </p>
        </div>
      </div>

      <Button variant="secondary" block :loading="resetting" @click="resetTestData">
        <template #prefix>
          <RotateCcw :size="16" />
        </template>
        {{ resetting ? '恢复中...' : '从生产环境恢复' }}
      </Button>
    </div>
  </Sheet>
</template>
