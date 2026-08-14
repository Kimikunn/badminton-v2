<script setup>
/**
 * S6Rankings — S6 积分榜
 * 上篇因果链：① 王选（一次性投掷定第 1-4 轮王序 → 每轮形态；旧数据回退逐轮展示）→ ② 形态说明 → 排名
 * 下篇因果链（切片二/三）：阶段进度 → 上篇优胜 → ① 灵魂契合（掷骰/总点数/解锁阶层）
 *   → ② 王之宝库（库存剩余 + 卡片激活状态）→ ③ 组合星尘榜（结算卡修正后的星尘
 *   + VS 对阵 + 排名 + 最强组合）
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
  KING_FORMS, KING_RULES, SOUL_RULES, COMBO_SCORING_RULES,
  TREASURY_CARDS, TREASURY_TIERS, CARD_PLAY_RULES, getSoulTierLabel
} from '@/rules/s6'
import { Crown, Dice5, Handshake, Gem, Trophy } from 'lucide-vue-next'

const props = defineProps({
  rankings: { type: Array, default: () => [] },
  season: { type: Object, default: null },
  rounds: { type: Array, default: () => [] },
  matches: { type: Array, default: () => [] },
  comboRankings: { type: Array, default: () => [] },
  topWinner: { type: Object, default: null },
  kingRights: { type: Array, default: () => [] }
})

const ruleSheet = ref(null)
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

// --- Data ---
const s6Data = computed(() => props.season?.comebackData?.s6 || {})
const topKings = computed(() => s6Data.value.topKings || {})
const seeds = computed(() => s6Data.value.seeds || {})
const soulBond = computed(() => s6Data.value.soulBond || {})
const treasury = computed(() => s6Data.value.treasury || {})

const topRounds = computed(() =>
  [...props.rounds]
    .filter(r => Number(r.roundNo) >= 1 && Number(r.roundNo) <= 4)
    .sort((a, b) => Number(a.roundNo) - Number(b.roundNo))
)
const comboRounds = computed(() =>
  [...props.rounds]
    .filter(r => Number(r.roundNo) >= 5 && Number(r.roundNo) <= 7)
    .sort((a, b) => Number(a.roundNo) - Number(b.roundNo))
)
const started = computed(() => topRounds.value.length > 0)

// 一次性王序（[{ playerId, dice, rolls? }]，第 i 位即第 i+1 轮的王）；
// 旧数据（prod 第 1 轮，无 kingOrder）为 null，王选面板回退逐轮展示
const kingOrder = computed(() => {
  const order = s6Data.value.kingOrder
  return Array.isArray(order) && order.length === 4 ? order : null
})

function kingFormOf(roundNo) {
  return topKings.value[String(roundNo)]?.form || null
}

// 王权（每轮第四名给王提供饮料；王第四名顺延第三名）：按轮次索引的规则模块计算结果
const kingRightByRound = computed(() =>
  Object.fromEntries(props.kingRights.map(row => [row.roundNo, row]))
)

// 王权行内文案：未完赛轮次不误导——无已完赛比赛显示待定，部分完赛标注进行中
function kingRightText(roundNo) {
  const row = kingRightByRound.value[Number(roundNo)]
  if (!row) return ''
  if (!row.lastPlace) return '王权：待定'
  if (!row.complete) return `王权：${playerName(row.lastPlace)} 暂列末位 · 进行中`
  if (row.kingIsLast) return `王权：王第四名，顺延第三名 ${playerName(row.provider)} 提供饮料`
  return `王权：${playerName(row.provider)} 提供饮料`
}

// 王序条目展示：首投骰面；重投过的由模板补注重投序列
function kingOrderDice(entry) {
  return entry.rolls?.[0] || entry.dice
}

const kingRows = computed(() =>
  topRounds.value.map(round => {
    const king = topKings.value[String(round.roundNo)] || null
    return {
      roundNo: round.roundNo,
      status: round.status,
      rolls: Array.isArray(king?.rolls) ? king.rolls : [],
      kingId: king?.kingId || null,
      form: king?.form || null
    }
  })
)

// 灵魂契合面板：按轮次 × 组合展开已持久化的判定
const soulRows = computed(() =>
  [5, 6, 7].flatMap(roundNo => {
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
  if (activation.timing === 'anytime') return '已使用'
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

const topDone = computed(() => topRounds.value.filter(r => r.status === 'completed').length)
const comboDone = computed(() => comboRounds.value.filter(r => r.status === 'completed').length)

const stageItems = computed(() => [
  {
    label: '上篇',
    value: `${topDone.value}/4`,
    hint: '王选 · 形态',
    active: topRounds.value.length > 0,
    percent: topDone.value / 4 * 100
  },
  {
    label: '下篇',
    value: comboRounds.value.length ? `${comboDone.value}/${Math.max(comboRounds.value.length, 3)}` : '待开始',
    hint: '灵魂契合 · 组合星尘',
    active: comboRounds.value.length > 0,
    percent: comboDone.value / 3 * 100
  }
])

// 最强组合：3 轮组合赛全部完成后取星尘第一
const comboChampion = computed(() => {
  if (comboDone.value < 3 || !props.comboRankings.length) return null
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
  king: '王选规则',
  daiqing: '黛青形态',
  feihong: '绯红形态',
  yuebai: '月白形态',
  soul: '灵魂契合规则',
  treasury: '王之宝库',
  combo: '组合计分规则'
}
const ruleTitle = computed(() => RULE_TITLES[ruleSheet.value] || '')
const sheetRules = computed(() => {
  if (ruleSheet.value === 'king') return KING_RULES
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
  const form = KING_FORMS[ruleSheet.value]
  if (!form) return []
  return [
    { id: 'form', title: `${form.name}形态`, text: form.effect },
    ...KING_RULES.filter(rule => rule.id !== 'roll')
  ]
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- ① 王选 —— 一次性投掷定第 1-4 轮王序 + 每轮形态 -->
    <Card v-if="started || kingOrder" padding="md">
      <div class="flex items-center gap-2 mb-3">
        <Dice5 :size="16" class="text-fg-secondary" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">王选</h3>
      </div>
      <!-- 新口径：一次投掷的王序，第 i 位即第 i+1 轮的王 -->
      <div v-if="kingOrder" class="flex flex-col gap-2">
        <div
          v-for="(entry, i) in kingOrder" :key="entry.playerId"
          class="p-3 rounded-lg bg-canvas border border-line-light cursor-pointer transition-transform duration-fast active:scale-95"
          @click="ruleSheet = 'king'"
        >
          <!-- 固定列网格：轮次/王/骰子/形态四列跨行对齐 -->
          <div class="grid grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_4.25rem] items-center gap-x-2">
            <span class="text-xs font-semibold font-mono text-fg-muted">R{{ i + 1 }}</span>
            <span class="flex items-center gap-1.5 min-w-0">
              <Crown :size="13" class="text-accent shrink-0" />
              <span class="text-sm font-semibold text-fg truncate">{{ playerName(entry.playerId) }}</span>
            </span>
            <span class="flex items-center justify-end gap-1">
              <DiceChip :value="kingOrderDice(entry)" />
              <template v-if="entry.rolls?.length > 1">
                <span class="text-2xs text-fg-muted">重投</span>
                <DiceChip v-for="(v, j) in entry.rolls.slice(1)" :key="j" :value="v" />
              </template>
            </span>
            <span class="flex justify-center">
              <Badge v-if="kingFormOf(i + 1)" variant="purple" size="sm">{{ KING_FORMS[kingFormOf(i + 1)]?.name }}</Badge>
              <Badge v-else variant="muted" size="sm">待选形态</Badge>
            </span>
          </div>
          <p v-if="kingRightByRound[i + 1]" class="mt-1.5 pl-9 text-xs text-fg-muted">{{ kingRightText(i + 1) }}</p>
        </div>
      </div>
      <!-- 旧口径：逐轮王选（无王序的历史数据，如 prod 第 1 轮） -->
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="row in kingRows" :key="row.roundNo"
          class="p-3 rounded-lg bg-canvas border border-line-light cursor-pointer transition-transform duration-fast active:scale-95"
          :class="{ 'opacity-60': !row.kingId }"
          @click="ruleSheet = 'king'"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-sm font-bold font-mono text-fg">R{{ row.roundNo }}</span>
            <Badge v-if="row.form" variant="purple" size="sm">{{ KING_FORMS[row.form]?.name }}</Badge>
            <Badge v-else variant="muted" size="sm">{{ row.kingId ? '待选形态' : '待王选' }}</Badge>
          </div>
          <div v-if="row.rolls.length" class="flex flex-wrap gap-2">
            <span
              v-for="roll in row.rolls" :key="roll.playerId"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border"
              :class="roll.playerId === row.kingId ? 'border-accent bg-accent-subtle text-accent font-semibold' : 'border-line-light text-fg-secondary'"
            >
              <Crown v-if="roll.playerId === row.kingId" :size="12" />
              {{ playerName(roll.playerId) }} <DiceChip :value="roll.dice" />
            </span>
          </div>
          <p v-else class="text-xs text-fg-muted italic">尚未进行王选</p>
          <p v-if="kingRightByRound[row.roundNo]" class="mt-1.5 text-xs text-fg-muted">{{ kingRightText(row.roundNo) }}</p>
        </div>
      </div>
    </Card>

    <!-- ② 形态 —— 王选决定的结果 -->
    <div class="grid grid-cols-3 gap-2">
      <div
        v-for="form in Object.values(KING_FORMS)" :key="form.id"
        class="flex flex-col items-center gap-1 p-4 rounded-lg bg-surface border border-line-light text-center cursor-pointer transition-transform duration-fast active:scale-95"
        @click="ruleSheet = form.id"
      >
        <span class="text-sm font-semibold text-fg">{{ form.name }}</span>
        <span class="text-2xs text-fg-muted">{{ form.keyword }}</span>
      </div>
    </div>

    <!-- ====== 下篇（切片二） ====== -->
    <!-- 阶段进度 -->
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

    <!-- 上篇优胜（标准大分/小分结算第一名） -->
    <Card v-if="topWinner" padding="md">
      <div class="flex items-center gap-2 mb-3">
        <Crown :size="16" class="text-fg-secondary" />
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">上篇优胜</h3>
      </div>
      <div class="flex items-center gap-4">
        <Avatar :name="topWinner.name" :src="topWinner.avatar" size="xl" />
        <div class="flex-1 min-w-0">
          <span class="block text-lg font-bold text-fg truncate">{{ topWinner.name }}</span>
          <span class="block text-xs text-fg-muted">{{ topWinner.wins || 0 }}胜 · {{ topWinner.totalPoints || 0 }}分</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xs text-fg-muted">大分</span>
          <span class="text-3xl font-extrabold font-display text-accent">{{ topWinner.finalBigScore ?? topWinner.bigScore ?? 0 }}</span>
        </div>
      </div>
    </Card>

    <!-- ① 灵魂契合 —— 下篇每轮赛前的组合判定 -->
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

    <!-- ② 王之宝库 —— 灵魂契合解锁的奖励库存与卡片激活状态（切片三：效果已执行） -->
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
    <Card v-if="comboRounds.length && comboRankings.length" padding="md">
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

    <!-- ④ 排名（上篇标准大分/小分结算） -->
    <S1Rankings :rankings="rankings" />

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
