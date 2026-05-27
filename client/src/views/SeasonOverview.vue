<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSeasonsStore, useMatchesStore, usePlayersStore } from '@/stores'
import { STATUS } from '@/constants'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { useSeasonSelector } from '@/composables/useSeasonSelector'
import { useViewAccent } from '@/composables/useViewAccent'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SeasonTabs from '@/components/season/SeasonTabs.vue'
import { BarChart3, ClipboardList, Trash2, CheckCircle } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const router = useRouter()
const seasonsStore = useSeasonsStore()
const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()
const { getSeasonColor } = useSeasonTheme()
const { getSelectedSeasonId, setSelectedSeasonId } = useSeasonSelector()
const { setViewAccent, viewStyle } = useViewAccent()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

const selectedSeasonId = ref(getSelectedSeasonId())
const currentSeason = computed(() => seasonsStore.getSeasonById(selectedSeasonId.value) || seasonsStore.currentSeason)

const rounds = computed(() => {
  if (!currentSeason.value) return []
  return seasonsStore.getRoundsBySeason(currentSeason.value.id).sort((a,b) => a.roundNo - b.roundNo)
})

const stats = computed(() => {
  const rds = rounds.value
  const completed = rds.filter(r => r.status === STATUS.COMPLETED).length
  const inProg = rds.filter(r => r.status === STATUS.IN_PROGRESS).length
  const current = rds.find(r => r.status === STATUS.IN_PROGRESS) || rds.find(r => r.status === STATUS.PENDING)
  return { total: currentSeason.value?.totalRounds || 0, completed, inProgress: inProg, currentRound: current, currentRoundNo: current?.roundNo || completed }
})

function selectSeason(id) { selectedSeasonId.value=id; setSelectedSeasonId(id); const s=seasonsStore.getSeasonById(id); if(s?.color)setViewAccent(getSeasonColor(s.color)) }

const showCreate = ref(false)
const creating = ref(false)
const canCreate = computed(() => {
  if (!currentSeason.value || currentSeason.value.status==='completed') return false
  const maxRound = Math.max(0, ...rounds.value.map(r => r.roundNo))
  const hasUnfinishedRound = rounds.value.some(r =>
    r.status !== STATUS.COMPLETED || getRoundMatches(r.id).some(m => m.status !== STATUS.COMPLETED)
  )
  return maxRound < stats.value.total && !hasUnfinishedRound
})

async function createNextRound() {
  creating.value = true
  try {
    const maxRound = Math.max(0, ...rounds.value.map(r => r.roundNo))
    const nextNo = maxRound + 1
    const created = await seasonsStore.createRound({ seasonId: currentSeason.value.id, roundNo: nextNo })
    matchesStore.upsertMatches(created?.matches || [])
    toast.show(`第 ${nextNo} 轮已创建`, 'success')
    showCreate.value = false
  } catch(e) { toast.show('创建失败: '+e.message, 'error') }
  creating.value = false
}

function getTeams(ids) { return ids?.map(id=>playersStore.getPlayerName(id)).join('/')||'—' }
function getScore(mid) { const s=matchesStore.getMatchScore(mid); return s.scoreA+s.scoreB>0?`${s.scoreA}:${s.scoreB}`:'' }
function getRoundMatches(rid) { return matchesStore.matches.filter(m=>m.roundId===rid).sort((a,b)=>{const o={in_progress:0,pending:1,completed:2};return (o[a.status]||3)-(o[b.status]||3)}) }
function goScoring(mid) { router.push(`/scoring/${mid}`) }
async function handleDeleteMatch(match) {
  const ok = await confirmAction({
    title: '删除比赛',
    message: '确认删除这场比赛？',
    confirmText: '删除'
  })
  if (!ok) return
  try { await matchesStore.deleteMatch(match.id); toast.show('已删除','success') }
  catch(e) { toast.show('删除失败','error') }
}

function seasonStatusLabel(status) {
  return status === 'ongoing' ? '进行中' : status === 'pending' ? '未开始' : '已完成'
}

function seasonStatusVariant(status) {
  return status === 'ongoing' ? 'success' : 'muted'
}

onMounted(() => { const s = currentSeason.value; if (s?.color) setViewAccent(getSeasonColor(s.color)) })
</script>

<template>
  <div class="flex flex-col gap-4" :style="viewStyle">
    <!-- Season tabs -->
    <SeasonTabs :seasons="seasonsStore.seasons" :selected-id="selectedSeasonId" @select="selectSeason" />

    <EmptyState v-if="!currentSeason" icon="BarChart3" title="暂无赛季" />

    <template v-else>
      <!-- Progress -->
      <Card padding="md">
        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="text-sm font-semibold text-fg">第 {{ stats.completed }}/{{ stats.total }} 轮</h3>
          </div>
          <Badge :variant="seasonStatusVariant(currentSeason.status)" size="sm">{{ seasonStatusLabel(currentSeason.status) }}</Badge>
        </div>
        <div class="h-1.5 bg-line rounded-full overflow-hidden mb-3">
          <div class="h-full bg-accent rounded-full transition-[width] duration-500 ease-out" :style="{width:(stats.completed/stats.total*100)+'%'}"></div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button v-if="canCreate" variant="primary" size="sm" @click="showCreate=true">+ 创建第 {{ stats.currentRoundNo+1 }} 轮</Button>
          <Button variant="secondary" size="sm" @click="router.push('/season/rounds')">轮次记录</Button>
          <Button variant="secondary" size="sm" @click="router.push('/season/rankings')">积分榜</Button>
          <Button v-if="currentSeason.ruleId!=='standard'" variant="secondary" size="sm" @click="router.push('/season/rules')">规则面板</Button>
        </div>
      </Card>

      <!-- Current round -->
      <Card v-if="stats.currentRound" padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-3">第 {{ stats.currentRound.roundNo }} 轮 · {{ stats.currentRound.status==='in_progress'?'进行中':'待开始' }}</h3>
        <div class="flex flex-col gap-0.5">
          <div v-for="m in getRoundMatches(stats.currentRound.id)" :key="m.id" class="flex items-center gap-2 py-2 px-3 rounded-lg"
            :class="m.status===STATUS.IN_PROGRESS ? 'bg-success-subtle' : 'bg-canvas'">
            <span class="flex-1 text-sm font-medium text-fg cursor-pointer" @click="goScoring(m.id)">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
            <span class="text-sm font-semibold font-mono text-accent" v-if="getScore(m.id)">{{ getScore(m.id) }}</span>
            <Badge v-else-if="m.status===STATUS.PENDING" variant="warning" size="sm">待打</Badge>
            <Badge v-else variant="success" size="sm">Live</Badge>
            <button v-if="m.status===STATUS.IN_PROGRESS" class="px-2 py-0.5 border border-accent rounded-lg bg-accent-subtle text-accent text-xs cursor-pointer" @click="goScoring(m.id)">记分</button>
            <button class="bg-transparent border-none cursor-pointer text-sm opacity-50 text-fg" @click="handleDeleteMatch(m)"><Trash2 :size="14" /></button>
          </div>
        </div>
      </Card>

      <EmptyState v-else-if="stats.completed===0" icon="ClipboardList" title="暂无轮次" description="创建第一轮开始比赛" />
      <EmptyState v-else-if="stats.completed===stats.total" icon="CheckCircle" title="全部轮次已完成" />
    </template>

    <Sheet :show="showCreate" title="创建下一轮" @close="showCreate=false">
      <div class="flex flex-col gap-4">
        <p class="text-sm text-fg-secondary">为「{{ currentSeason?.name }}」创建第 {{ stats.currentRoundNo+1 }} 轮，自动生成对阵。</p>
        <div class="flex gap-3">
          <Button variant="secondary" size="md" class="flex-1" @click="showCreate=false">取消</Button>
          <Button variant="primary" size="md" class="flex-1" :loading="creating" @click="createNextRound">确认</Button>
        </div>
      </div>
    </Sheet>
  </div>
</template>
