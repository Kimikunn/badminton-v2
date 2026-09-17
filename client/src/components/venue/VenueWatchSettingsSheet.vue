<script setup>
/**
 * VenueWatchSettingsSheet — 全局监控设置（凭证状态 + 总开关 + 锁场场地优先级）
 * 入口在订场记录卡片页头的齿轮；凭证走服务端 .env，不在此管理
 *
 * @props {boolean} show - 是否显示
 *
 * @events close
 */
import { ref, computed, watch } from 'vue'
import { useIntentStore } from '@/stores'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/ui/Sheet.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps({
  show: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

const store = useIntentStore()
const toast = useToast()

// 就绪 = 推送配置 + 小程序登录态均已配置（凭证在服务器 .env）
const isReady = computed(() => !!(store.config?.pushConfigured && store.config?.gymTokenConfigured))

const savingConfig = ref(false)

async function toggleEnabled() {
  if (savingConfig.value) return
  savingConfig.value = true
  try {
    await store.saveConfig({ enabled: !store.config?.enabled })
  } catch (e) { toast.show(e.message || '操作失败', 'error') }
  savingConfig.value = false
}

// 锁场优先级：意图不设偏好时按这个顺序选场地
const priorityDraft = ref([])
const savingPriority = ref(false)

// 每次打开都用服务端配置重置草稿，避免上次未保存的勾选残留
watch(() => props.show, (visible) => {
  if (visible) priorityDraft.value = [...(store.config?.areaPriority || [])]
})

function togglePriorityDraft(areaId) {
  const list = [...priorityDraft.value]
  const idx = list.indexOf(areaId)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(areaId)
  priorityDraft.value = list
}

async function savePriority() {
  savingPriority.value = true
  try {
    await store.saveConfig({ areaPriority: [...priorityDraft.value] })
    toast.show('已保存', 'success')
    emit('close')
  } catch (e) { toast.show(e.message || '保存失败', 'error') }
  savingPriority.value = false
}
</script>

<template>
  <Sheet :show="show" title="辅助订场设置" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-sm text-fg">监控状态</span>
        <span class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :class="isReady ? 'bg-success' : 'bg-line'"></span>
          <span class="text-xs" :class="isReady ? 'text-success' : 'text-fg-muted'">{{ isReady ? '已就绪' : '未配置' }}</span>
        </span>
      </div>
      <p v-if="!isReady" class="text-2xs text-fg-muted">请在服务器 .env 配置凭证（PUSH_TOKEN / GYM_TOKEN_USER），修改后需重启服务生效。</p>

      <div class="flex items-center justify-between">
        <span class="text-sm text-fg">总开关</span>
        <button
          class="switch"
          :class="{ on: store.config?.enabled }"
          role="switch"
          :aria-checked="!!store.config?.enabled"
          :disabled="savingConfig || !store.config"
          @click="toggleEnabled"
        ><span class="switch-dot"></span></button>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-fg">锁场优先级</span>
        <div v-if="store.areas.length" class="flex gap-1.5 flex-wrap">
          <button
            v-for="a in store.areas" :key="a.areaId"
            class="chip"
            :class="{ on: priorityDraft.includes(a.areaId) }"
            @click="togglePriorityDraft(a.areaId)"
          >{{ a.areaName }}<template v-if="priorityDraft.indexOf(a.areaId) >= 0">·{{ priorityDraft.indexOf(a.areaId) + 1 }}</template></button>
        </div>
        <div v-else class="py-4 text-center text-xs text-fg-muted">暂无场地数据</div>
      </div>

      <Button variant="primary" size="md" block :loading="savingPriority" @click="savePriority">保存优先级</Button>
    </div>
  </Sheet>
</template>

<style scoped>
@reference "@/styles/global.css";

/* Toggle switch */
.switch { @apply relative w-10 h-6 shrink-0 border-none rounded-full bg-line cursor-pointer transition-colors duration-fast p-0 disabled:opacity-50 disabled:cursor-not-allowed; }
.switch.on { @apply bg-accent; }
.switch-dot { @apply absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-fast; }
.switch.on .switch-dot { transform: translateX(16px); }

/* 多选 chip */
.chip { @apply px-3 py-1.5 rounded-full border border-line bg-canvas text-sm text-fg-secondary cursor-pointer transition-all duration-fast active:scale-95; }
.chip.on { @apply bg-accent-subtle border-accent text-accent font-medium; }
</style>
