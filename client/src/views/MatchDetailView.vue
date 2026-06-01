<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayersStore, useMatchesStore, useSeasonsStore } from '@/stores'
import { STATUS, BEST_OF_OPTIONS } from '@/constants'
import { getRule } from '@/rules'
import { useViewAccent } from '@/composables/useViewAccent'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { useScoringValidation } from '@/composables/useScoringValidation'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Dumbbell, Trash2, Pencil, ArrowLeft } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const route = useRoute()
const router = useRouter()
const playersStore = usePlayersStore()
const matchesStore = useMatchesStore()
const seasonsStore = useSeasonsStore()
const { setViewAccent, viewStyle } = useViewAccent()
const { getSeasonColor } = useSeasonTheme()
const toast = useToast()
const isTestMode = import.meta.env.VITE_TEST_MODE === 'true'
const { confirm: confirmAction } = useConfirm()
const editValidation = useScoringValidation()

const matchId = computed(() => route.params.id)
const match = computed(() => {
  const m = matchesStore.getMatchById(matchId.value)
  if (m?.seasonId) { const s = seasonsStore.getSeasonById(m.seasonId); if (s?.color) setViewAccent(getSeasonColor(s.color)) }
  return m
})
const games = computed(() => matchesStore.getGamesByMatch(matchId.value))

const isCompleted = computed(() => match.value?.status === STATUS.COMPLETED)
const teamAPlayers = computed(() => match.value?.teamA?.map(id => playersStore.getPlayerName(id)) || [])
const teamBPlayers = computed(() => match.value?.teamB?.map(id => playersStore.getPlayerName(id)) || [])
const matchScore = computed(() => matchesStore.getMatchScore(matchId.value))
const seasonName = computed(() => {
  if (!match.value?.seasonId) return ''
  return seasonsStore.getSeasonById(match.value.seasonId)?.name || ''
})

const season = computed(() => match.value?.seasonId ? seasonsStore.getSeasonById(match.value.seasonId) : null)
const round = computed(() => match.value?.roundId ? seasonsStore.getRoundById(match.value.roundId) : null)
const gameConfig = computed(() => {
  if (season.value?.ruleId === 's5' && round.value) {
    return getRule('s5').getGameConfig(round.value.roundNo, { season: season.value })
  }
  return { scoringMode: 'standard', targetScore: 21, maxScore: 30, requiresWinner: false }
})
const targetScore = computed(() => gameConfig.value.targetScore || 21)

function validateEditScores(scoreA, scoreB) {
  return editValidation.validateGameScore(scoreA, scoreB, {
    targetScore: targetScore.value,
    maxScore: gameConfig.value.maxScore || 30,
    scoringMode: gameConfig.value.scoringMode
  })
}

function teamShortLabel(team) {
  if (team === 'a') return 'A队'
  if (team === 'b') return 'B队'
  return ''
}

function getGameRuleEvents(game) {
  return Array.isArray(game?.ruleEvents) ? game.ruleEvents : []
}

function getRuleEventBadges(game) {
  return getGameRuleEvents(game).map(event => {
    if (event.type === 'pierce') {
      return { id: event.id, label: `贯穿 · ${teamShortLabel(event.payload?.team)}`, variant: 'purple' }
    }
    if (event.type === 'resistance') {
      return { id: event.id, label: '抵抗', variant: 'warning' }
    }
    return { id: event.id, label: event.type, variant: 'muted' }
  })
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/matches')
  }
}

// Edit game
const editingGame = ref(null)
const editForm = ref({ scoreA: 0, scoreB: 0 })
const showEditGame = ref(false)
const editSaving = ref(false)

function openEditGame(game) {
  editingGame.value = game
  editForm.value = { scoreA: game.scoreA || 0, scoreB: game.scoreB || 0 }
  showEditGame.value = true
}

async function saveGameEdit() {
  const scoreA = Number(editForm.value.scoreA)
  const scoreB = Number(editForm.value.scoreB)
  const result = validateEditScores(scoreA, scoreB)
  if (!result.canEnd) { toast.show(result.reason, 'warning'); return }

  editSaving.value = true
  try {
    await matchesStore.updateCompletedGameScore(
      editingGame.value.id, scoreA, scoreB, result.winner
    )
    toast.show('比分已更新', 'success')
    showEditGame.value = false
  } catch (e) { toast.show(e.message || '更新失败', 'error') }
  editSaving.value = false
}

watch(() => [editForm.value.scoreA, editForm.value.scoreB], ([a, b]) => {
  validateEditScores(a, b)
})

// Delete game
async function handleDeleteGame(game) {
  const ok = await confirmAction({
    title: '撤回本局',
    message: `确认撤回 G${game.gameNo}？\n撤回后可重新记分。`,
    confirmText: '撤回'
  })
  if (!ok) return
  try {
    await matchesStore.revertGame(game.id)
    toast.show(`G${game.gameNo} 已撤回`, 'success')
  } catch (e) { toast.show(e.message || '操作失败', 'error') }
}

// Delete match
async function handleDeleteMatch() {
  const ok = await confirmAction({
    title: '删除整场比赛',
    message: '确认删除整场比赛及其所有局？\n此操作不可撤销。',
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await matchesStore.deleteMatch(matchId.value)
    toast.show('已删除', 'success')
    router.back()
  } catch (e) { toast.show('删除失败', 'error') }
}
</script>

<template>
  <div class="p-4 flex flex-col gap-4" :style="viewStyle">
    <button aria-label="返回" class="w-9 h-9 rounded-full bg-surface-hover text-fg-secondary flex items-center justify-center cursor-pointer border-none transition-all duration-fast active:scale-90" @click="goBack">
      <ArrowLeft :size="20" />
    </button>

    <EmptyState v-if="!match" icon="Dumbbell" title="比赛未找到" />

    <template v-else>
      <Card padding="md">
        <div class="flex items-center gap-2 mb-4">
          <Badge :variant="isCompleted?'muted':'success'" size="sm">{{ isCompleted?'已结束':'Live' }}</Badge>
          <span class="text-sm text-fg-muted">{{ BEST_OF_OPTIONS.find(o=>o.value===match.bestOf)?.label }}</span>
          <span class="text-sm text-accent ml-auto" v-if="match.seasonId">{{ seasonName }}</span>
          <span class="text-sm text-accent ml-auto" v-else>{{ match.date }}</span>
        </div>

        <div v-if="isCompleted" class="text-center py-4">
          <div class="flex items-center justify-center gap-4">
            <div class="flex flex-col items-center gap-0.5 min-w-[60px]" :class="{'text-accent font-bold':match.winner==='a'}">
              <span v-for="n in teamAPlayers" :key="n" class="text-base font-medium">{{ n }}</span>
            </div>
            <span class="text-3xl font-extrabold font-mono shrink-0 text-fg">{{ matchScore.scoreA }}:{{ matchScore.scoreB }}</span>
            <div class="flex flex-col items-center gap-0.5 min-w-[60px]" :class="{'text-accent font-bold':match.winner==='b'}">
              <span v-for="n in teamBPlayers" :key="n" class="text-base font-medium">{{ n }}</span>
            </div>
          </div>
          <Button v-if="isTestMode || season?.status !== STATUS.COMPLETED" variant="ghost" size="sm" @click="handleDeleteMatch" class="mt-3 !text-danger"><Trash2 :size="14" class="inline mr-1" />删除比赛</Button>
        </div>
      </Card>

      <!-- Games -->
      <Card v-if="games.length>0" padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-3">各局详情</h3>
        <div class="flex flex-col gap-1">
          <div v-for="g in games" :key="g.id" class="flex items-center gap-2 p-3 rounded-md"
            :class="{'bg-canvas':g.status===STATUS.COMPLETED, 'bg-success-subtle border border-dashed border-success':g.status===STATUS.IN_PROGRESS}">
            <span class="text-sm font-semibold font-mono text-fg-muted min-w-7">G{{ g.gameNo }}</span>
            <template v-if="g.status===STATUS.COMPLETED">
              <span class="text-lg font-bold font-mono flex gap-1 flex-1 text-fg">
                <span :class="{'text-accent':g.winner==='a'}">{{ g.scoreA }}</span><span class="text-fg-muted">:</span><span :class="{'text-accent':g.winner==='b'}">{{ g.scoreB }}</span>
              </span>
              <div v-if="getRuleEventBadges(g).length" class="flex flex-wrap justify-end gap-1 max-w-[120px]">
                <Badge v-for="badge in getRuleEventBadges(g)" :key="badge.id" :variant="badge.variant" size="sm">{{ badge.label }}</Badge>
              </div>
              <div v-if="isTestMode || season?.status !== STATUS.COMPLETED" class="flex gap-1">
                <button class="g-btn" @click="openEditGame(g)" title="编辑比分"><Pencil :size="14" /></button>
                <button class="g-btn" @click="handleDeleteGame(g)" title="撤回此局"><Trash2 :size="12" /></button>
              </div>
            </template>
            <span v-else-if="g.status===STATUS.IN_PROGRESS" class="text-lg font-bold font-mono flex-1 text-fg">{{ g.scoreA||0 }}:{{ g.scoreB||0 }}</span>
            <span v-else class="text-sm text-fg-muted flex-1">—</span>
          </div>
        </div>
      </Card>
    </template>

    <!-- Edit game sheet -->
    <Sheet :show="showEditGame" title="修改比分" @close="showEditGame=false">
      <div class="flex flex-col gap-4">
        <p v-if="editingGame" class="text-sm text-fg-secondary">G{{ editingGame.gameNo }} · {{ teamAPlayers.join('/') }} vs {{ teamBPlayers.join('/') }}</p>
        <div class="flex items-center gap-3">
          <div class="flex-1"><Input label="A队得分" type="number" v-model.number="editForm.scoreA" /></div>
          <span class="text-sm text-fg-muted font-bold">VS</span>
          <div class="flex-1"><Input label="B队得分" type="number" v-model.number="editForm.scoreB" /></div>
        </div>
        <p class="text-xs min-h-[1.25rem] leading-tight" :class="editValidation.errorMessage ? 'text-danger' : 'text-fg-muted'">
          {{ editValidation.errorMessage || '需达到'+targetScore+'分且领先2分（或先到30）' }}
        </p>
        <div class="flex gap-3">
          <Button variant="secondary" size="md" class="flex-1" @click="showEditGame=false">取消</Button>
          <Button variant="primary" size="md" class="flex-1" :loading="editSaving" @click="saveGameEdit">保存</Button>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
.g-btn { @apply w-[26px] h-[26px] border-none rounded-full bg-transparent text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast active:scale-90; }
.g-btn:hover { @apply bg-accent-subtle text-accent; }
</style>
