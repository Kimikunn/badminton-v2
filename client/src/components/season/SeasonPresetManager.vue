<script setup>
/**
 * SeasonPresetManager — 创建赛季业务入口
 *
 * 只显示「下一个可创建的赛季」（S1→S2→S3→S4→S5 顺序，已完成才能建下一个）。
 * 不自己套 Sheet，由调用方决定展示容器。
 */
import { computed, ref, watch } from 'vue'
import { CheckCircle2, Palette, Users, Wand2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { SEASON_COLOR_OPTIONS, SEASON_PRESETS, buildPresetSeasonName } from '@/constants/seasonPresets'
import { useSeasonSelector } from '@/composables/useSeasonSelector'
import { useToast } from '@/composables/useToast'
import { usePlayersStore, useSeasonsStore } from '@/stores'

const emit = defineEmits(['created'])

const toast = useToast()
const playersStore = usePlayersStore()
const seasonsStore = useSeasonsStore()
const { setSelectedSeasonId } = useSeasonSelector()

const showConfirm = ref(false)
const selectedColor = ref('blue')
const creating = ref(false)

const activePlayers = computed(() => playersStore.players)
const participantIds = computed(() => activePlayers.value.map(p => p.id))
const canCreate = computed(() => participantIds.value.length === 4)

const nextPreset = computed(() => {
  const existingRuleIds = new Set(seasonsStore.seasons.map(s => s.ruleId))
  const next = SEASON_PRESETS.find(p => !existingRuleIds.has(p.ruleId))
  if (!next) return null

  // 前一赛季必须已完成，才能创建下一个
  const idx = SEASON_PRESETS.indexOf(next)
  if (idx === 0) return next
  const prevPreset = SEASON_PRESETS[idx - 1]
  const prevSeason = seasonsStore.seasons.find(s => s.ruleId === prevPreset.ruleId)
  if (!prevSeason || prevSeason.status !== 'completed') return null

  return next
})

const nextPresetLabel = computed(() => {
  const p = nextPreset.value
  return p ? `${p.code} ${p.label}` : ''
})

watch(nextPreset, (p) => {
  if (p) selectedColor.value = p.color
})

function openConfirm() {
  if (!nextPreset.value) {
    toast.show('所有赛季已创建完毕', 'info')
    return
  }
  if (!canCreate.value) {
    toast.show('当前成员不是 4 人，无法创建赛季', 'error')
    return
  }
  showConfirm.value = true
}

function closeConfirm() {
  if (creating.value) return
  showConfirm.value = false
}

async function createSeason() {
  if (!nextPreset.value) return

  creating.value = true
  try {
    const preset = nextPreset.value
    const created = await seasonsStore.createSeason({
      name: buildPresetSeasonName(preset),
      totalRounds: preset.totalRounds,
      bestOf: preset.bestOf,
      participants: participantIds.value,
      ruleId: preset.ruleId,
      color: selectedColor.value
    })

    if (!created) throw new Error('创建赛季失败')

    await seasonsStore.init({ force: true })
    setSelectedSeasonId(created.id)
    toast.show(`已创建 ${created.name}`, 'success')
    emit('created', created)
    showConfirm.value = false
  } catch (error) {
    toast.show(error.message || '创建赛季失败', 'error')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Preset info card -->
    <div v-if="nextPreset" class="rounded-xl bg-accent-subtle border border-accent/15 p-4">
      <p class="text-sm font-semibold text-accent-text flex items-center gap-2">
        <CheckCircle2 :size="17" />
        {{ nextPreset.code }} · {{ nextPreset.label }}
      </p>
      <p class="text-xs text-fg-muted mt-2 leading-relaxed">{{ nextPreset.description }}</p>
    </div>

    <div v-else class="rounded-xl bg-surface-hover p-4 text-center text-sm text-fg-muted">
      全部赛季已创建完毕
    </div>

    <div v-if="!canCreate" class="rounded-lg border border-danger/20 bg-danger-subtle p-3 text-xs text-danger leading-relaxed">
      当前检测到 {{ participantIds.length }} 名成员，预设赛季要求固定 4 名成员。
    </div>

    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-lg bg-surface-hover p-3">
        <p class="text-3xs uppercase tracking-wide text-fg-muted mb-1">规则</p>
        <p class="font-medium text-fg">{{ nextPreset?.ruleId || '—' }}</p>
      </div>
      <div class="rounded-lg bg-surface-hover p-3">
        <p class="text-3xs uppercase tracking-wide text-fg-muted mb-1">轮次</p>
        <p class="font-medium text-fg">{{ nextPreset ? nextPreset.totalRounds + ' 轮' : '—' }}</p>
      </div>
      <div class="rounded-lg bg-surface-hover p-3">
        <p class="text-3xs uppercase tracking-wide text-fg-muted mb-1">赛制</p>
        <p class="font-medium text-fg">{{ nextPreset ? (nextPreset.bestOf === 3 ? '三局两胜' : nextPreset.bestOf + '局') : '—' }}</p>
      </div>
      <div class="rounded-lg bg-surface-hover p-3">
        <p class="text-3xs uppercase tracking-wide text-fg-muted mb-1">颜色</p>
        <p class="font-medium text-fg">{{ SEASON_COLOR_OPTIONS.find(o => o.value === selectedColor)?.label || selectedColor }}</p>
      </div>
    </div>

    <div class="rounded-lg bg-surface-hover p-3">
      <p class="text-xs font-medium text-fg mb-2 flex items-center gap-1.5">
        <Users :size="14" />
        参赛成员（固定 4 人）
      </p>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="player in activePlayers"
          :key="player.id"
          class="px-2 py-1 rounded-full bg-surface text-xs text-fg-secondary border border-line"
        >
          {{ player.name }}
        </span>
      </div>
    </div>

    <label class="block">
      <span class="text-xs font-medium text-fg-secondary mb-2 flex items-center gap-1.5">
        <Palette :size="14" />
        赛季颜色
      </span>
      <select
        v-model="selectedColor"
        class="w-full h-11 px-3 rounded-lg border border-line bg-surface text-fg outline-none focus:border-accent"
      >
        <option v-for="color in SEASON_COLOR_OPTIONS" :key="color.value" :value="color.value">
          {{ color.label }}
        </option>
      </select>
    </label>

    <div class="flex gap-2 pt-1">
      <Button variant="secondary" block :disabled="creating" @click="closeConfirm">取消</Button>
      <Button block :loading="creating" :disabled="!canCreate || !nextPreset" @click="createSeason">
        确认创建
      </Button>
    </div>
  </div>
</template>
