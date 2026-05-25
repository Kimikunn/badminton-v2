<script setup>
import { computed } from 'vue'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import S1Rankings from '@/components/season/S1Rankings.vue'
import { useSeasonAction } from '@/composables/useSeasonAction'
import { CheckCircle2, Dice5, PauseCircle, ReceiptText, Shield, Sparkles } from 'lucide-vue-next'

const props = defineProps({
  rankings: { type: Array, default: () => [] },
  season: { type: Object, default: null },
  rounds: { type: Array, default: () => [] }
})

const { recordSeasonAction } = useSeasonAction()

const s5Data = computed(() => props.season?.comebackData?.s5 || {})
const roundDice = computed(() => s5Data.value?.roundDice || {})
const started = computed(() => props.rounds.length > 0)
const debtRecords = computed(() => s5Data.value?.debtRecords || {})
const debtSettlements = computed(() => s5Data.value?.debtSettlements || {})
const pauseUses = computed(() => Array.isArray(s5Data.value?.pauseUses) ? s5Data.value.pauseUses : [])
const roundModeRows = computed(() =>
  [...props.rounds]
    .sort((a, b) => Number(a.roundNo || 0) - Number(b.roundNo || 0))
    .map(round => {
      const dice = roundDice.value[String(round.roundNo)]
      const mode = dice?.mode === 'mutation' ? 'mutation' : 'order'
      return {
        id: round.id,
        roundNo: round.roundNo,
        dice: dice?.dice || '?',
        mode,
        modeLabel: mode === 'mutation' ? '异变' : '秩序',
        targetScore: mode === 'mutation' ? 15 : 21,
        status: round.status
      }
    })
)
const orderRoundRows = computed(() => roundModeRows.value.filter(round => round.mode === 'order'))
const mutationRoundRows = computed(() => roundModeRows.value.filter(round => round.mode === 'mutation'))
const debtActionRows = computed(() =>
  Object.values(debtRecords.value)
    .filter(Boolean)
    .sort((a, b) => Number(a.roundNo || 0) - Number(b.roundNo || 0))
)
const pierceRows = computed(() =>
  props.rankings
    .filter(player => Number(player.pierceCount || 0) > 0)
    .sort((a, b) => Number(b.pierceCount || 0) - Number(a.pierceCount || 0))
)
const skillCards = computed(() => {
  const cards = [
    ...pierceRows.value.map(player => {
      const use = getPauseUse(player.id)
      return {
        id: `pause-${player.id}`,
        type: 'pause',
        tone: 'order',
        icon: PauseCircle,
        title: '暂停卡',
        subject: player.name || player.id,
        detail: rewardText(player),
        badge: `贯穿 ×${player.pierceCount}`,
        used: !!use,
        usedAt: use?.usedAt || null,
        payload: player
      }
    }),
    ...debtActionRows.value.map(record => {
      const settlement = getDebtSettlement(record.roundNo)
      return {
        id: `debt-${record.roundNo}`,
        type: 'debt',
        tone: 'mutation',
        icon: ReceiptText,
        title: '债务卡',
        subject: `第 ${record.roundNo} 轮`,
        detail: `债务方 ${playerNames(record.debtors)} · 受益方 ${playerNames(record.creditors)}`,
        badge: '异变排名',
        used: !!settlement,
        usedAt: settlement?.settledAt || null,
        payload: record
      }
    })
  ]
  return cards.sort((a, b) => {
    if (a.used !== b.used) return a.used ? 1 : -1
    if (a.type !== b.type) return a.type === 'debt' ? -1 : 1
    return a.id.localeCompare(b.id)
  })
})
const pendingSkillCount = computed(() => skillCards.value.filter(card => !card.used).length)

function rewardText(player) {
  const rewards = []
  if (player.bonusSmallScore) rewards.push(`小分 +${player.bonusSmallScore}`)
  if (player.bonusBigScore) rewards.push(`大分 +${player.bonusBigScore}`)
  if (player.pauseSeconds) rewards.push(`暂停 ${player.pauseSeconds} 秒`)
  if (player.shards) rewards.push(`碎片 ${player.shards}`)
  return rewards.join(' · ')
}

function playerName(playerId) {
  return props.rankings.find(player => player.id === playerId)?.name || playerId
}

function playerNames(playerIds = []) {
  return playerIds.map(playerName).join('、')
}

function formatDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function getPauseUse(playerId) {
  return pauseUses.value.find(item => item.playerId === playerId) || null
}

function getDebtSettlement(roundNo) {
  return debtSettlements.value[String(roundNo)] || null
}

async function recordPauseUse(player) {
  if (!props.season?.id || getPauseUse(player.id)) return

  await recordSeasonAction(
    props.season.id,
    's5_pause_use',
    { playerId: player.id },
    '暂停卡已使用'
  )
}

async function recordDebtSettlement(record) {
  if (!props.season?.id || !record || getDebtSettlement(record.roundNo)) return

  await recordSeasonAction(
    props.season.id,
    's5_debt_settlement',
    { roundNo: record.roundNo },
    '债务卡已使用'
  )
}

async function useSkillCard(card) {
  if (card.used) return
  if (card.type === 'pause') await recordPauseUse(card.payload)
  if (card.type === 'debt') await recordDebtSettlement(card.payload)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <Card padding="md">
      <div class="flex items-start gap-3 s5-hero">
        <div class="s5-hero-icon">
          <Dice5 :size="20" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="text-base font-semibold text-fg">S5 异变秩序</h3>
            <Badge :variant="started ? 'success' : 'muted'" size="sm">{{ started ? '进行中' : '未开始' }}</Badge>
          </div>
          <p class="text-xs text-fg-muted leading-relaxed">
            赛前掷骰决定本轮模式。秩序为 21 分制，异变为 15 分制；排名按大分、小分、得分排序。
          </p>
        </div>
      </div>
    </Card>

    <Card v-if="started" padding="md">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">轮次模式</h3>
        <div class="flex items-center gap-1.5">
          <Badge variant="success" size="sm">秩序 {{ orderRoundRows.length }}</Badge>
          <Badge variant="danger" size="sm">异变 {{ mutationRoundRows.length }}</Badge>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="s5-mode-card s5-mode-order">
          <div class="flex items-center gap-2">
            <Shield :size="15" />
            <span class="text-xs font-semibold">秩序局</span>
          </div>
          <strong>{{ orderRoundRows.length }}</strong>
          <span>21 分制 · 抵抗生效</span>
        </div>
        <div class="s5-mode-card s5-mode-mutation">
          <div class="flex items-center gap-2">
            <Sparkles :size="15" />
            <span class="text-xs font-semibold">异变局</span>
          </div>
          <strong>{{ mutationRoundRows.length }}</strong>
          <span>15 分制 · 债务排名</span>
        </div>
      </div>

      <div class="s5-round-grid">
        <div
          v-for="round in roundModeRows"
          :key="round.id"
          class="s5-round-chip"
          :class="round.mode === 'mutation' ? 'is-mutation' : 'is-order'"
        >
          <span>R{{ round.roundNo }}</span>
          <strong>{{ round.dice }}</strong>
          <em>{{ round.modeLabel }}</em>
        </div>
      </div>
    </Card>

    <Card v-if="skillCards.length" padding="md">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">技能卡使用</h3>
        <Badge :variant="pendingSkillCount ? 'purple' : 'success'" size="sm">
          {{ pendingSkillCount ? `待使用 ${pendingSkillCount}` : '全部已使用' }}
        </Badge>
      </div>

      <div class="flex flex-col gap-2">
        <div
          v-for="card in skillCards"
          :key="card.id"
          class="s5-skill-card"
          :class="[
            card.tone === 'mutation' ? 'is-mutation' : 'is-order',
            { 'is-used': card.used }
          ]"
        >
          <div class="s5-skill-icon">
            <component :is="card.icon" :size="18" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <p class="text-sm font-semibold text-fg truncate">{{ card.subject }}</p>
              <Badge :variant="card.tone === 'mutation' ? 'danger' : 'purple'" size="sm">{{ card.title }}</Badge>
            </div>
            <p class="text-xs text-fg-muted truncate mt-0.5">{{ card.detail }}</p>
            <p v-if="card.used" class="text-xs text-success truncate mt-0.5">
              已使用 · {{ formatDateTime(card.usedAt) }}
            </p>
          </div>
          <div class="s5-skill-action">
            <Badge :variant="card.tone === 'mutation' ? 'danger' : 'purple'" size="sm">{{ card.badge }}</Badge>
            <Button v-if="!card.used" variant="secondary" size="sm" @click="useSkillCard(card)">使用</Button>
            <span v-else class="s5-used-mark"><CheckCircle2 :size="14" /> 已使用</span>
          </div>
        </div>
      </div>
    </Card>

    <S1Rankings :rankings="rankings" />
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

.s5-hero-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: var(--radius-lg);
  color: var(--color-danger);
  background: linear-gradient(135deg, var(--color-danger-subtle), var(--color-accent-subtle));
}

.s5-mode-card {
  min-height: 86px;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.s5-mode-card strong {
  display: block;
  margin-top: 8px;
  font-family: var(--font-display);
  font-size: 1.75rem;
  line-height: 1;
}

.s5-mode-card span:last-child {
  display: block;
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: var(--text-2xs);
}

.s5-mode-order {
  color: var(--color-success);
  background: linear-gradient(135deg, var(--color-success-subtle), var(--color-surface));
}

.s5-mode-mutation {
  color: var(--color-danger);
  background: linear-gradient(135deg, var(--color-danger-subtle), var(--color-surface));
}

.s5-round-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 8px;
}

.s5-round-chip {
  min-height: 52px;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-light);
  background: var(--color-bg);
}

.s5-round-chip span,
.s5-round-chip em {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--text-2xs);
  font-style: normal;
}

.s5-round-chip strong {
  display: block;
  margin: 1px 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  line-height: 1;
}

.s5-round-chip.is-order strong { color: var(--color-success); }
.s5-round-chip.is-mutation strong { color: var(--color-danger); }

.s5-skill-card {
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg);
}

.s5-skill-card.is-order {
  border-color: oklch(0.60 0.18 300 / 0.16);
}

.s5-skill-card.is-mutation {
  border-color: oklch(0.55 0.22 25 / 0.18);
}

.s5-skill-card.is-used {
  opacity: 0.82;
}

.s5-skill-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.s5-skill-card.is-order .s5-skill-icon {
  color: var(--color-badge-purple);
  background: var(--color-badge-purple-bg);
}

.s5-skill-card.is-mutation .s5-skill-icon {
  color: var(--color-danger);
  background: var(--color-danger-subtle);
}

.s5-skill-action {
  min-width: 68px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: none;
}

.s5-used-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  color: var(--color-success);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
</style>
