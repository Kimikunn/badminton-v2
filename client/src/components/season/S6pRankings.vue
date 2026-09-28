<script setup>
/**
 * S7Rankings — S7-王权之续 积分榜
 * 语义 = S6 下半赛季独立成季：3 轮固定轮换组合赛（每轮 1 场 2v2、PA7）。
 * 面板链：总排名（个人 胜/负/大分）→ 轮次进度 → ① 灵魂契合（掷骰/总点数/解锁阶层）
 *   → ② 王之宝库（库存剩余 + 卡片激活状态）→ ③ 组合星尘榜（VS 对阵 + 星尘排名
 *   + 最强组合）。无上篇/王选/王权（getRule('s6p') 相应方法恒空）。
 */
import { ref, computed } from 'vue'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Sheet from '@/components/ui/Sheet.vue'
import Avatar from '@/components/ui/Avatar.vue'
import RankMedal from '@/components/ui/RankMedal.vue'
import DiceChip from '@/components/ui/DiceChip.vue'
import S1Rankings from '@/components/season/S1Rankings.vue'
import {
  SOUL_RULES, COMBO_SCORING_RULES,
  TREASURY_CARDS, TREASURY_TIERS, CARD_PLAY_RULES, getSoulTierLabel
} from '@/rules/s6p'
import { Dice5, Handshake, Gem, Trophy } from 'lucide-vue-next'

const props = defineProps({
  rankings: { type: Array, default: () => [] },
  season: { type: Object, default: null },
  rounds: { type: Array, default: () => [] },
  matches: { type: Array, default: () => [] },
  comboRankings: { type: Array, default: () => [] }
})

const ruleSheet = ref(null)
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

// --- Data ---
const s6pData = computed(() => props.season?.comebackData?.s6p || {})
const seeds = computed(() => s6pData.value.seeds || {})
const soulBond = computed(() => s6pData.value.soulBond || {})
const treasury = computed(() => s6pData.value.treasury || {})

const comboRounds = computed(() =>
  [...props.rounds]
    .filter(r => Number(r.roundNo) >= 1 && Number(r.roundNo) <= 3)
    .sort((a, b) => Number(a.roundNo) - Number(b.roundNo))
)
const started = computed(() => comboRounds.value.length > 0)

// 灵魂契合面板：按轮次 × 组合展开已持久化的判定
const soulRows = computed(() =>
  [1, 2, 3].flatMap(roundNo => {
    const bond = soulBond.value[String(roundNo)]
    if (!bond) return []
    return Object.entries(bond).map(([label, combo]) => ({ roundNo, label, combo }))
  })
)

// 王之宝库面板：有库存或已触发天选的组合；库存即剩余次数（服务端在暗选/使用提交时扣减），
// activations 为卡片使用记录（切片三写入）
const treasuryRows = computed(() =>
  Object.entries(treasury.value)
    .map(([label, entry]) => ({
      label,
      inventory: entry?.inventory || {},
      chosen: !!entry?.chosen,
      activations: Array.isArray(entry?.activations) ? entry.activations : []
    }))
    .filter(row => row.chosen || row.activations.length > 0
      || Object.values(row.inventory).some(count => count > 0))
)

// 激活状态展示：局前暗选按 待亮出/已亮出/已消耗；随时卡为 已使用
function activationState(activation) {
  // post_game/旧 anytime：局后记录即已使用
  if (activation.timing !== 'pre_game') return '已使用'
  if (activation.consumed) return '已消耗'
  return activation.revealed ? '已亮出' : '待亮出'
}

function activationLabel(activation) {
  const card = TREASURY_CARDS[activation.cardId]
  const game = activation.gameNo ? `G${activation.gameNo} ` : ''
  // 逐人暗选：局前卡带选手名（如 "G2 张三·爆破"）
  const player = activation.timing === 'pre_game' && activation.playerId ? `${playerName(activation.playerId)}·` : ''
  return `${game}${player}${card?.name || activation.cardId || '不使用'}`
}

const comboDone = computed(() => comboRounds.value.filter(r => r.status === 'completed').length)

const stageItems = computed(() => [
  {
    label: '轮次',
    value: comboRounds.value.length ? `${comboDone.value}/${totalRounds.value}` : '待开始',
    hint: '灵魂契合 · 组合星尘',
    active: comboRounds.value.length > 0,
    percent: totalRounds.value ? comboDone.value / totalRounds.value * 100 : 0
  }
])

// 最强组合：三轮组合赛全部完成后取星尘第一（星尘同分按轮次内净胜分裁决）
const totalRounds = computed(() => Number(props.season?.totalRounds) || 3)
const comboChampion = computed(() => {
  if (comboDone.value < totalRounds.value || !props.comboRankings.length) return null
  return props.comboRankings[0]
})

// --- Helpers ---
function playerName(id) {
  return props.rankings.find(p => p.id === id)?.name || id
}

function getComboPlayers(teamIds) {
  if (!teamIds) return '—'
  return teamIds.map(id => playerName(id)).join(' ')
}

function getComboLabel(c) {
  if (!c.teamA) return c.label
  return c.teamA.map(id => playerName(id)?.[0] || id).join('')
}

// 灵魂契合/宝库行内的组合成员名（种子 A-D → 选手名）
function comboMemberNames(label) {
  const ids = String(label).split('').map(key => seeds.value[key]).filter(Boolean)
  return ids.length ? ids.map(id => playerName(id)).join(' / ') : `${label} 组合`
}

const RULE_TITLES = {
  soul: '灵魂契合规则',
  treasury: '王之宝库',
  combo: '组合计分规则'
}
const ruleTitle = computed(() => RULE_TITLES[ruleSheet.value] || '')
const sheetRules = computed(() => {
  if (ruleSheet.value === 'soul') return SOUL_RULES
  if (ruleSheet.value === 'combo') return COMBO_SCORING_RULES
  if (ruleSheet.value === 'treasury') {
    return [
      ...CARD_PLAY_RULES,
      ...TREASURY_TIERS.map(tier => ({
        id: `tier-${tier.tier}`,
        title: `${tier.name}（${tier.range}）`,
        text: tier.cards.map(cardId => {
          const card = TREASURY_CARDS[cardId]
          const uses = card.uses ? ` ×${card.uses}` : ''
          return `${card.name}${uses}：${card.effect}（${card.condition}）`
        }).join('\n')
      }))
    ]
  }
  return []
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- ====== 总排名：个人 胜/负/大分（组合赛按队计入个人） ====== -->
    <div class="flex flex-col gap-5">
      <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">总排名</h3>
      <S1Rankings :rankings="rankings" />
    </div>

    <!-- 轮次进度 -->
    <div class="flex gap-2">
      <div
        v-for="item in stageItems" :key="item.label"
        class="flex-1 p-3 rounded-lg bg-surface border text-center transition-[background-color,border-color] duration-slow"
        :class="item.active ? 'opacity-100 border-accent/40' : 'opacity-50 border-line-light'"
      >
        <div class="flex justify-between items-baseline mb-1.5 text-sm">
          <span>{{ item.label }}</span>
          <strong class="text-accent font-bold">{{ item.value }}</strong>
        </div>
        <div class="h-[3px] bg-line rounded-sm overflow-hidden mb-1">
          <div class="h-full bg-accent rounded-sm" :style="{ width: item.percent + '%', transition: 'width 0.5s var(--ease-out)' }"></div>
        </div>
        <small class="text-2xs text-fg-muted">{{ item.hint }}</small>
      </div>
    </div>

    <!-- ① 灵魂契合 —— 每轮赛前的组合判定 -->
    <Card v-if="soulRows.length" padding="md">
      <div class="flex items-center gap-2 mb-3">
        <Handshake :size="16" class="text-fg-secondary" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">灵魂契合</h3>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="row in soulRows" :key="`${row.roundNo}-${row.label}`"
          class="p-3 rounded-lg bg-canvas border border-line-light cursor-pointer transition-transform duration-fast active:scale-95"
          @click="ruleSheet = 'soul'"
        >
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            <span class="text-sm font-bold font-mono text-fg">R{{ row.roundNo }}</span>
            <span class="text-xs font-semibold text-fg-secondary">{{ comboMemberNames(row.label) }}</span>
            <Badge v-if="row.combo.unlockTier" variant="accent" size="sm">{{ getSoulTierLabel(row.combo.unlockTier) }}</Badge>
            <Badge v-else-if="row.combo.rolls?.length === 2" variant="muted" size="sm">未解锁</Badge>
            <Badge v-else variant="muted" size="sm">判定中</Badge>
            <Badge v-if="row.combo.unlockTier === 'chosen'" variant="gold" size="sm">天选</Badge>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-for="roll in row.combo.rolls || []" :key="roll.playerId"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-line-light text-fg-secondary"
            >
              {{ playerName(roll.playerId) }}
              <DiceChip v-for="(v, j) in roll.dice || []" :key="j" :value="v" />
              <span class="font-semibold text-fg">→ {{ roll.used }}</span>
              <span v-if="roll.reforged" class="text-accent">重铸</span>
            </span>
            <span v-if="row.combo.total != null" class="text-xs text-fg-muted">
              总点数 <span class="text-sm font-bold text-accent">{{ row.combo.total }}</span>
              <template v-if="row.combo.rolls?.length === 2 && row.combo.rolls[0].used === row.combo.rolls[1].used">（同点 +1）</template>
            </span>
          </div>
        </div>
      </div>
    </Card>

    <!-- ② 王之宝库 —— 灵魂契合解锁的奖励库存与卡片激活状态（效果已执行） -->
    <Card v-if="treasuryRows.length" padding="md">
      <div class="flex items-center gap-2 mb-3">
        <Gem :size="16" class="text-fg-secondary" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">王之宝库</h3>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="row in treasuryRows" :key="row.label"
          class="p-3 rounded-lg bg-canvas border border-line-light cursor-pointer transition-transform duration-fast active:scale-95"
          @click="ruleSheet = 'treasury'"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-semibold text-fg-secondary">{{ comboMemberNames(row.label) }}</span>
            <Badge v-if="row.chosen" variant="gold" size="sm">天选已触发</Badge>
          </div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="(count, cardId) in row.inventory" :key="cardId"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border"
              :class="count > 0 ? 'border-line-light text-fg-secondary' : 'border-line-light text-fg-muted opacity-50'"
            >
              {{ TREASURY_CARDS[cardId]?.name || cardId }}
              <span class="font-semibold" :class="count > 0 ? 'text-fg' : 'text-fg-muted'">×{{ count }}</span>
            </span>
            <span v-if="!Object.keys(row.inventory).length" class="text-xs text-fg-muted italic">暂无库存</span>
          </div>
          <div v-if="row.activations.length" class="flex flex-wrap gap-2 mt-2">
            <span
              v-for="activation in row.activations.slice(-6)" :key="activation.id"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-2xs border border-line-light text-fg-muted"
            >
              {{ activationLabel(activation) }}
              <span class="font-medium text-fg-secondary">{{ activationState(activation) }}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>

    <!-- ③ 组合星尘 —— 固定对阵与星尘排名（点击标题查看计分规则） -->
    <Card v-if="started && comboRankings.length" padding="md">
      <div
        class="flex items-center gap-2 mb-3 cursor-pointer transition-transform duration-fast active:scale-95"
        @click="ruleSheet = 'combo'"
      >
        <Trophy :size="16" class="text-fg-secondary" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">组合星尘</h3>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="r in comboRounds" :key="r.id"
          class="p-3 rounded-lg bg-canvas border border-line-light"
          :class="{ 'border-success': r.status === 'completed' }"
        >
          <div class="flex justify-between mb-2">
            <span class="text-sm font-bold font-mono text-fg">R{{ r.roundNo }}</span>
            <span class="text-2xs text-fg-muted" :class="{ '!text-success': r.status === 'completed' }">
              {{ r.status === 'completed' ? '已完成' : r.status === 'in_progress' ? '进行中' : '待开始' }}
            </span>
          </div>
          <div class="flex items-center justify-center gap-3">
            <template v-for="c in comboRankings.filter(x => x.roundNo === r.roundNo && x.perspective === 'a')" :key="c.label">
              <div
                class="flex flex-col items-center gap-0.5 min-w-[50px] p-2 rounded-md transition-[background-color] duration-fast"
                :class="{ 'bg-accent-subtle': c.matchWon && r.status === 'completed' }"
              >
                <span
                  v-for="id in c.teamA" :key="id"
                  class="text-sm font-medium text-fg"
                  :class="{ '!font-bold !text-accent': c.matchWon && r.status === 'completed' }"
                >{{ playerName(id) }}</span>
              </div>
              <span class="text-xs text-fg-muted font-bold shrink-0">VS</span>
              <div
                class="flex flex-col items-center gap-0.5 min-w-[50px] p-2 rounded-md transition-[background-color] duration-fast"
                :class="{ 'bg-accent-subtle': !c.matchWon && r.status === 'completed' }"
              >
                <span
                  v-for="id in c.teamB" :key="id"
                  class="text-sm font-medium text-fg"
                  :class="{ '!font-bold !text-accent': !c.matchWon && r.status === 'completed' }"
                >{{ playerName(id) }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 组合星尘榜 -->
      <div class="flex flex-col gap-2 mt-3">
        <div
          v-for="(c, i) in comboRankings" :key="c.label"
          class="flex items-center gap-3 px-4 py-3 rounded-lg border"
          :class="i === 0 ? 'bg-accent-subtle border-accent/30' : 'bg-surface border-line-light'"
        >
          <RankMedal v-if="i < 3" :rank="i + 1" />
          <span v-else class="text-sm font-bold font-mono text-fg-muted w-6 text-center">{{ i + 1 }}</span>
          <span class="text-sm font-bold font-mono text-accent min-w-8">{{ getComboLabel(c) }}</span>
          <div class="flex-1 min-w-0">
            <span class="block text-sm font-semibold text-fg truncate">{{ getComboPlayers(c.teamA) }} vs {{ getComboPlayers(c.teamB) }}</span>
            <span class="block text-xs text-fg-muted mt-0.5">{{ c.matchWon ? '胜' : (c.roundStatus === 'completed' ? '负' : '待打') }} · {{ c.totalPoints || 0 }}分</span>
            <span v-if="c.completedGames" class="block text-2xs text-fg-muted mt-0.5">
              小分 {{ c.baseStars || 0 }}<template v-if="c.streakBonus"> · 连胜 +{{ c.streakBonus }}</template><template v-if="c.breakerBonus"> · 终结 +{{ c.breakerBonus }}</template><template v-for="adj in c.adjustments || []" :key="`${adj.gameNo}-${adj.cardId}-${adj.affectedSide}`"> · {{ adj.display }}</template>
            </span>
          </div>
          <span class="text-sm font-bold text-accent">✦{{ c.stars || 0 }}</span>
        </div>
      </div>
    </Card>

    <!-- 最强组合（3 轮组合赛完成后，星尘第一） -->
    <div
      v-if="comboChampion"
      class="rounded-lg border p-5 bg-[linear-gradient(135deg,var(--color-badge-gold-bg),var(--color-surface))] border-badge-gold/40"
    >
      <div class="flex items-center gap-2 mb-3">
        <Trophy :size="16" class="text-badge-gold" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">最强组合</h3>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex-1 min-w-0">
          <span class="block text-lg font-bold text-fg truncate">{{ getComboPlayers(comboChampion.teamA) }}</span>
          <span class="block text-xs text-fg-muted">{{ comboChampion.matchWon ? '本轮获胜' : '星尘领先' }} · {{ comboChampion.totalPoints || 0 }}分</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-lg text-badge-gold">✦</span>
          <span class="text-3xl font-extrabold font-display text-accent">{{ comboChampion.stars || 0 }}</span>
        </div>
      </div>
    </div>

    <!-- Rule sheets -->
    <Sheet :show="!!ruleSheet" :title="ruleTitle" @close="ruleSheet = null">
      <div class="flex flex-col gap-3 text-sm leading-relaxed">
        <div
          v-for="(rule, i) in sheetRules" :key="rule.id"
          class="p-3 rounded-lg bg-surface-hover border border-line-light"
        >
          <p class="font-semibold text-fg">{{ CIRCLED[i] }} {{ rule.title }}</p>
          <p class="text-xs text-fg-muted mt-1 whitespace-pre-line">{{ rule.text }}</p>
        </div>
      </div>
    </Sheet>
  </div>
</template>
