<script setup>
import { ref, computed } from 'vue'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import S1Rankings from '@/components/season/S1Rankings.vue'
import Sheet from '@/components/ui/Sheet.vue'
import { useSeasonAction } from '@/composables/useSeasonAction'
import { CheckCircle2, Dice5, PauseCircle, ReceiptText, Shield, Sparkles } from 'lucide-vue-next'

const props = defineProps({
  rankings: { type: Array, default: () => [] },
  season: { type: Object, default: null },
  rounds: { type: Array, default: () => [] }
})

const { recordSeasonAction } = useSeasonAction()
const ruleSheet = ref(null)
const DICE = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' }

// --- Data ---
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
        id: round.id, roundNo: round.roundNo,
        dice: dice?.dice || '?', mode,
        label: mode === 'mutation' ? '异变' : '秩序',
        score: mode === 'mutation' ? 15 : 21,
        status: round.status
      }
    })
)
const orderRounds = computed(() => roundModeRows.value.filter(r => r.mode === 'order'))
const mutationRounds = computed(() => roundModeRows.value.filter(r => r.mode === 'mutation'))

const debtActionRows = computed(() =>
  Object.values(debtRecords.value).filter(Boolean)
    .sort((a, b) => Number(a.roundNo || 0) - Number(b.roundNo || 0))
)
const pierceRows = computed(() =>
  props.rankings
    .filter(p => Number(p.pierceCount || 0) > 0)
    .sort((a, b) => Number(b.pierceCount || 0) - Number(a.pierceCount || 0))
)
const skillCards = computed(() => {
  const cards = [
    ...pierceRows.value.map(p => {
      const use = getPauseUse(p.id)
      return {
        id: `pause-${p.id}`, type: 'pause', tone: 'order',
        icon: PauseCircle, title: '暂停卡', subject: p.name || p.id,
        detail: rewardText(p), badge: `贯穿 ×${p.pierceCount}`,
        used: !!use, usedNote: use?.note || '', payload: p
      }
    }),
    ...debtActionRows.value.map(r => {
      const s = getDebtSettlement(r.roundNo)
      return {
        id: `debt-${r.roundNo}`, type: 'debt', tone: 'mutation',
        icon: ReceiptText, title: '债务卡', subject: `第 ${r.roundNo} 轮`,
        detail: `债务方 ${playerNames(r.debtors)} · 受益方 ${playerNames(r.creditors)}`,
        badge: '异变排名', used: !!s, usedAt: s?.settledAt || null, payload: r
      }
    })
  ]
  return cards.sort((a, b) => {
    if (a.used !== b.used) return a.used ? 1 : -1
    if (a.type !== b.type) return a.type === 'debt' ? -1 : 1
    return a.id.localeCompare(b.id)
  })
})
const pendingSkillCount = computed(() => skillCards.value.filter(c => !c.used).length)

// --- Helpers ---
function rewardText(p) {
  const r = []
  if (p.bonusSmallScore) r.push(`小分 +${p.bonusSmallScore}`)
  if (p.bonusBigScore) r.push(`大分 +${p.bonusBigScore}`)
  if (p.pauseSeconds) r.push(`暂停 ${p.pauseSeconds}s`)
  if (p.shards) r.push(`碎片 ×${p.shards}`)
  return r.join(' · ')
}
function playerName(id) { return props.rankings.find(p => p.id === id)?.name || id }
function playerNames(ids = []) { return ids.map(playerName).join('、') }
function fmtDt(v) {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function getPauseUse(pid) { return pauseUses.value.find(u => u.playerId === pid) || null }
function getDebtSettlement(rn) { return debtSettlements.value[String(rn)] || null }

function activeRoundNo() {
  const active = props.rounds?.find(r => r.status === 'in_progress')
  return active?.roundNo || props.rounds?.length || ''
}

async function recordPauseUse(p) {
  if (!props.season?.id || getPauseUse(p.id)) return
  const rn = activeRoundNo()
  await recordSeasonAction(props.season.id, 's5_pause_use', { playerId: p.id, note: rn ? `第${rn}轮使用` : '' }, '暂停卡已使用')
}
async function recordDebtSettlement(r) {
  if (!props.season?.id || !r || getDebtSettlement(r.roundNo)) return
  await recordSeasonAction(props.season.id, 's5_debt_settlement', { roundNo: r.roundNo }, '债务卡已使用')
}
async function useSkillCard(c) {
  if (c.used) return
  if (c.type === 'pause') await recordPauseUse(c.payload)
  if (c.type === 'debt') await recordDebtSettlement(c.payload)
}

const RULE_TITLES = { dice: '骰子规则', order: '秩序 · 21分制', mutation: '异变 · 15分制', pierce: '贯穿奖励', debt: '异变债务' }
const ruleTitle = computed(() => RULE_TITLES[ruleSheet.value] || '')
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- ① 轮次骰子 —— 每轮开始前第一件事 -->
    <Card v-if="started" padding="md">
      <div class="flex items-center gap-2 mb-3">
        <Dice5 :size="16" class="text-fg-secondary" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">轮次骰子</h3>
      </div>
      <div class="s5-grid">
        <div
          v-for="r in roundModeRows" :key="r.id"
          class="s5-chip cursor-pointer active:scale-95 transition-transform" :class="r.mode === 'mutation' ? 'is-mut' : 'is-ord'" @click="ruleSheet = 'dice'"
        >
          <span class="s5-chip-r">R{{ r.roundNo }}</span>
          <span class="s5-chip-d">{{ DICE[r.dice] || r.dice }}</span>
          <span class="s5-chip-m">{{ r.label }}</span>
        </div>
      </div>
    </Card>

    <!-- ② 秩序 / 异变 —— 骰子决定的结果 -->
    <div v-if="started" class="grid grid-cols-2 gap-3">
      <div class="s5-mode s5-ord" @click="ruleSheet = 'order'">
        <Shield :size="18" /><strong>{{ orderRounds.length }}</strong>
        <span class="s5-mode-label">秩序</span>
        <span class="s5-mode-sub">抵抗 · 爆发 · 贯穿</span>
      </div>
      <div class="s5-mode s5-mut" @click="ruleSheet = 'mutation'">
        <Sparkles :size="18" /><strong>{{ mutationRounds.length }}</strong>
        <span class="s5-mode-label">异变</span>
        <span class="s5-mode-sub">混沌 · 债务 · 安魂曲</span>
      </div>
    </div>

    <!-- ③ 技能卡 -->
    <Card v-if="skillCards.length" padding="md">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide cursor-pointer active:text-accent" @click="ruleSheet = 'pierce'">技能卡</h3>
        <Badge :variant="pendingSkillCount ? 'purple' : 'success'" size="sm">
          {{ pendingSkillCount ? `待使用 ${pendingSkillCount}` : '全部已使用' }}
        </Badge>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="c in skillCards" :key="c.id"
          class="s5-skill-row" :class="[c.tone === 'mutation' ? 'is-mut' : 'is-ord', { used: c.used }]"
        >
          <div class="s5-skill-i" :class="c.tone"><component :is="c.icon" :size="16" /></div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-fg truncate">{{ c.subject }}</span>
              <Badge :variant="c.tone === 'mutation' ? 'danger' : 'purple'" size="sm">{{ c.title }}</Badge>
            </div>
            <p class="text-xs text-fg-muted truncate mt-0.5">{{ c.detail }}</p>
            <p v-if="c.used && c.usedNote" class="text-xs text-success mt-0.5">已使用 · {{ c.usedNote }}</p>
          </div>
          <div class="s5-skill-act">
            <Badge :variant="c.tone === 'mutation' ? 'danger' : 'purple'" size="sm">{{ c.badge }}</Badge>
            <Button v-if="!c.used" variant="secondary" size="sm" @click="useSkillCard(c)">使用</Button>
            <span v-else class="s5-done"><CheckCircle2 :size="14" /> 已使用</span>
          </div>
        </div>
      </div>
    </Card>

    <!-- ④ 排名 -->
    <S1Rankings :rankings="rankings" />

    <!-- Rule sheets -->
    <Sheet :show="!!ruleSheet" :title="ruleTitle" @close="ruleSheet = null">
      <div class="flex flex-col gap-3 text-sm leading-relaxed">
        <template v-if="ruleSheet === 'dice'">
          <p class="text-fg">每轮开始前掷骰子决定本轮模式：</p>
          <div class="flex items-center gap-3 p-3 rounded-lg bg-surface-hover border border-line-light">
            <span class="text-xl">⚁⚂⚃⚄</span>
            <div>
              <span class="font-semibold text-fg">秩序局</span>
              <span class="block text-xs text-fg-muted mt-0.5">21 分制 · 抵抗、爆发、贯穿</span>
            </div>
          </div>
          <div class="flex items-center gap-3 p-3 rounded-lg bg-surface-hover border border-line-light">
            <span class="text-xl">⚀⚅</span>
            <div>
              <span class="font-semibold text-fg">异变局</span>
              <span class="block text-xs text-fg-muted mt-0.5">15 分制 · 混沌、债务、安魂曲</span>
            </div>
          </div>
        </template>
        <template v-if="ruleSheet === 'order'">
          <div class="p-3 rounded-lg bg-surface-hover border border-line-light">
            <p class="font-semibold text-fg">① 抵抗</p>
            <p class="text-xs text-fg-muted mt-1">赛点分必须连拿 2 分才能获胜，即使不同分。</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-hover border border-line-light">
            <p class="font-semibold text-fg">② 爆发</p>
            <p class="text-xs text-fg-muted mt-1">一方先到 15 分触发。后 3 球每球得 2 分，可无视抵抗。</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-hover border border-line-light">
            <p class="font-semibold text-fg">③ 贯穿</p>
            <p class="text-xs text-fg-muted mt-1">爆发后优势方连拿 3 球触发。1次→小分+2+暂停 · 2次→大分+1 · 3次→大分+1。超出转碎片。</p>
          </div>
        </template>
        <template v-if="ruleSheet === 'mutation'">
          <div class="p-3 rounded-lg bg-surface-hover border border-line-light">
            <p class="font-semibold text-fg">① 混沌</p>
            <p class="text-xs text-fg-muted mt-1">有且仅有一方先到 11 分时触发。优势方得分→+3 分。劣势方得分→自身 +1 + 优势方 -3。可无限循环。</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-hover border border-line-light">
            <p class="font-semibold text-fg">② 债务</p>
            <p class="text-xs text-fg-muted mt-1">本轮 3、4 名向 1、2 名提供运动饮料。先看大分后看小分最后看得分。</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-hover border border-line-light">
            <p class="font-semibold text-fg">③ 金色安魂曲</p>
            <p class="text-xs text-fg-muted mt-1">BO3 决胜局使用球进化为金红超。</p>
          </div>
        </template>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

/* ── Dice grid ── */
.s5-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)); gap: 6px; }
.s5-chip {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 12px 4px 10px; border-radius: var(--radius-lg); text-align: center;
  border: 1px solid var(--color-border-light);
}
.s5-chip-r { font-size: var(--text-2xs); color: var(--color-text-muted); }
.s5-chip-d { font-size: 1.625rem; line-height: 1; }
.s5-chip-m { font-size: 10px; color: var(--color-text-muted); }
.s5-chip.is-ord { background: linear-gradient(180deg, var(--color-success-subtle), var(--color-bg)); }
.s5-chip.is-ord .s5-chip-d { color: var(--color-success); }
.s5-chip.is-mut { background: linear-gradient(180deg, var(--color-danger-subtle), var(--color-bg)); }
.s5-chip.is-mut .s5-chip-d { color: var(--color-danger); }

/* ── Mode cards ── */
.s5-mode {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 20px 12px; border-radius: var(--radius-lg); text-align: center; cursor: pointer;
}
.s5-mode strong { font-family: var(--font-display); font-size: 2rem; line-height: 1; }
.s5-mode-label { font-size: var(--text-xs); font-weight: var(--weight-semibold); letter-spacing: 0.06em; }
.s5-mode-sub { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
.s5-ord { color: var(--color-success); background: linear-gradient(135deg, var(--color-success-subtle), var(--color-surface)); }
.s5-mut { color: var(--color-danger); background: linear-gradient(135deg, var(--color-danger-subtle), var(--color-surface)); }

/* ── Skill cards ── */
.s5-skill-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-light); background: var(--color-bg);
}
.s5-skill-row.is-ord { border-color: oklch(0.60 0.18 300 / 0.16); }
.s5-skill-row.is-mut { border-color: oklch(0.55 0.22 25 / 0.18); }
.s5-skill-row.used { opacity: 0.78; }
.s5-skill-i { width: 32px; height: 32px; display: grid; place-items: center; flex: none; border-radius: var(--radius-lg); background: var(--color-surface); }
.s5-skill-i.order { color: var(--color-badge-purple); background: var(--color-badge-purple-bg); }
.s5-skill-i.mutation { color: var(--color-danger); background: var(--color-danger-subtle); }
.s5-skill-act { min-width: 64px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: none; }
.s5-done { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; color: var(--color-success); font-size: var(--text-xs); font-weight: var(--weight-medium); }
</style>
