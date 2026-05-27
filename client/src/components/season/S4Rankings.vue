<script setup>
import { computed, ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import RankMedal from '@/components/ui/RankMedal.vue'
import RankingRow from '@/components/ui/RankingRow.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { Crown, Dice5, Sprout, Handshake } from 'lucide-vue-next'

const props = defineProps({ rankings: Array, season: Object, rounds: Array, matches: Array, comboRankings: Array, topWinner: Object })

const rankTab = ref('individual')
const rankTabOptions = [
  { key: 'individual', label: '上篇-星尘榜' },
  { key: 'combo', label: '下篇-组合星尘' }
]

const s4Data = computed(() => props.season?.comebackData?.s4 || {})
const seeds = computed(() => s4Data.value?.seeds || {})
const topDice = computed(() => s4Data.value?.topDice || {})
const sorted = computed(() => [...props.rankings].sort((a,b)=>(b.stars||0)-(a.stars||0)))

const topRounds = computed(() => props.rounds?.filter(r=>r.roundNo<=4).sort((a,b)=>a.roundNo-b.roundNo)||[])
const comboRounds = computed(() => props.rounds?.filter(r=>r.roundNo>=5).sort((a,b)=>a.roundNo-b.roundNo)||[])

const diceEffects = {
  1:{name:'玄武的庇护',desc:'分差5分内败方也得1星尘',tone:'xuanwu'},
  2:{name:'白虎的领域',desc:'先到11分的队伍+1星尘',tone:'baihu'},
  3:{name:'白虎的领域',desc:'先到11分的队伍+1星尘',tone:'baihu'},
  4:{name:'青龙的眷顾',desc:'大场获胜+1,2:0获暂停卡',tone:'qinglong'},
  5:{name:'青龙的眷顾',desc:'大场获胜+1,2:0获暂停卡',tone:'qinglong'},
  6:{name:'朱雀降临',desc:'此轮星尘翻倍',tone:'zhuque'}
}

// Tone color map for dynamic style bindings
const toneColors = {
  xuanwu: { border: 'oklch(0.55 0.05 200)', bg: 'oklch(0.55 0.05 200/0.06)', orbBg: 'oklch(0.55 0.05 200/0.1)' },
  baihu: { border: 'oklch(0.7 0.02 100)', bg: 'oklch(0.7 0.02 100/0.06)', orbBg: 'oklch(0.7 0.02 100/0.1)' },
  qinglong: { border: 'oklch(0.55 0.15 160)', bg: 'oklch(0.55 0.15 160/0.06)', orbBg: 'oklch(0.55 0.15 160/0.1)' },
  zhuque: { border: 'oklch(0.55 0.20 30)', bg: 'oklch(0.55 0.20 30/0.06)', orbBg: 'oklch(0.55 0.20 30/0.1)' }
}

function getDiceTone(round) {
  if (!isSettled(round)) return null
  const effect = diceEffects[topDice.value[String(round.roundNo)]?.dice]
  return effect?.tone || null
}

function isSettled(round) { return round.status==='completed' && !!topDice.value[String(round.roundNo)] }
function getSeedPlayer(letter) { const pid = seeds.value[letter]; if (!pid) return '?'; const r = props.rankings?.find(p=>p.id===pid); return r?.name || pid }

function getComboLabel(c) {
  if (!c.teamA) return c.label
  return c.teamA.map(id => {
    const p = props.rankings?.find(r => r.id === id)
    return p?.name?.[0] || id
  }).join('')
}
function getComboPlayers(teamIds) {
  if (!teamIds) return '—'
  return teamIds.map(id => props.rankings?.find(p=>p.id===id)?.name || id).join(' ')
}

const stageItems = computed(() => [
  { label:'上篇', value:`${topRounds.value.filter(r=>r.status==='completed').length}/${Math.max(topRounds.value.length,4)}`, hint:'四象之力', active:topRounds.value.length>0, percent:topRounds.value.filter(r=>r.status==='completed').length/4*100 },
  { label:'排位', value:seeds.value.A?'已生成':'待定', hint:'种子席位', active:!!seeds.value.A, percent:seeds.value.A?100:0 },
  { label:'下篇', value:comboRounds.value.length?'进行中':'待开始', hint:'组合决战', active:comboRounds.value.length>0, percent:comboRounds.value.filter(r=>r.status==='completed').length/Math.max(comboRounds.value.length,3)*100 }
])
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- ====== 上篇 ====== -->
    <!-- Stage Progress -->
    <div class="flex gap-2">
      <div
        v-for="item in stageItems"
        :key="item.label"
        class="flex-1 p-3 rounded-lg bg-surface border text-center transition-[background-color,border-color] duration-slow"
        :class="item.active ? 'opacity-100 border-accent/40' : 'opacity-50 border-line-light'"
      >
        <div class="flex justify-between items-baseline mb-1.5 text-sm">
          <span>{{ item.label }}</span>
          <strong class="text-accent font-bold">{{ item.value }}</strong>
        </div>
        <div class="h-[3px] bg-line rounded-sm overflow-hidden mb-1">
          <div class="h-full bg-accent rounded-sm" :style="{width:item.percent+'%', transition:'width 0.5s var(--ease-out)'}"></div>
        </div>
        <small class="text-2xs text-fg-muted">{{ item.hint }}</small>
      </div>
    </div>

    <!-- Top Winner -->
    <div v-if="topWinner" class="rounded-lg border p-5 bg-[linear-gradient(135deg,var(--color-s4-gold-light),var(--color-s4-gold-lighter))] border-s4-gold-border">
      <div class="text-sm font-semibold text-fg mb-4"><Crown :size="16" class="inline" /> 上篇优胜</div>
      <div class="flex items-center gap-4">
        <Avatar :name="topWinner.name" :src="topWinner.avatar" size="xl" />
        <div class="flex-1">
          <span class="block text-lg font-bold">{{ topWinner.name }}</span>
          <span class="block text-xs text-fg-muted">{{ topWinner.wins || 0 }}胜 · {{ topWinner.totalPoints || 0 }}分</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-lg text-s4-gold">✦</span>
          <span class="text-3xl font-extrabold font-display text-accent">{{ topWinner.stars || 0 }}</span>
        </div>
      </div>
    </div>

    <!-- Top Phase Dice -->
    <div v-if="topRounds.length>0" class="bg-surface rounded-lg border border-line-light p-5">
      <div class="text-sm font-semibold text-fg mb-4"><Dice5 :size="16" class="inline" /> 四象之力</div>
      <div class="flex flex-col gap-3">
        <div
          v-for="r in topRounds"
          :key="r.id"
          class="flex items-center gap-4 p-4 rounded-lg bg-canvas border border-line-light"
          :class="{ 'opacity-60': !isSettled(r) }"
          :style="getDiceTone(r) ? { borderColor: toneColors[getDiceTone(r)].border, background: toneColors[getDiceTone(r)].bg } : {}"
        >
          <div
            class="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
            :style="getDiceTone(r) ? { background: toneColors[getDiceTone(r)].orbBg, boxShadow: `inset 0 0 0 2px ${toneColors[getDiceTone(r)].border}` } : { background: 'var(--color-surface-hover)' }"
          >
            <span v-if="topDice[String(r.roundNo)]" class="text-xl font-extrabold font-display">{{ topDice[String(r.roundNo)].dice }}</span>
            <span v-else class="text-lg text-fg-muted">?</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-bold font-mono text-fg-muted">R{{ r.roundNo }}</span>
              <span class="text-2xs px-1.5 py-px rounded-full font-medium" :class="r.status==='completed' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'">
                {{ r.status==='completed'?'已结算':'待投' }}
              </span>
            </div>
            <div v-if="topDice[String(r.roundNo)]" class="text-base font-semibold">{{ diceEffects[topDice[String(r.roundNo)].dice]?.name }}</div>
            <div v-if="topDice[String(r.roundNo)]" class="text-xs text-fg-muted mt-0.5">{{ diceEffects[topDice[String(r.roundNo)].dice]?.desc }}</div>
            <div v-else class="text-xs text-fg-muted mt-0.5 italic">尚未投掷骰子</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Seeds -->
    <div v-if="seeds.A" class="bg-surface rounded-lg border border-line-light p-5">
      <div class="text-sm font-semibold text-fg mb-4"><Sprout :size="16" class="inline" /> 种子席位</div>
      <div class="grid grid-cols-4 gap-2">
        <div v-for="letter in ['A','B','C','D']" :key="letter" class="text-center p-3 bg-canvas rounded-md">
          <span class="block text-xs text-fg-muted font-bold">{{ letter }}</span>
          <span class="block text-sm font-semibold mt-1">{{ getSeedPlayer(letter) }}</span>
        </div>
      </div>
    </div>

    <!-- ====== 下篇 ====== -->
    <!-- Combo Phase -->
    <div v-if="comboRounds.length>0" class="bg-surface rounded-lg border border-line-light p-5">
      <div class="text-sm font-semibold text-fg mb-4"><Handshake :size="16" class="inline" /> 下篇 · 组合决战</div>
      <div class="flex flex-col gap-3">
        <div v-for="r in comboRounds" :key="r.id" class="p-4 bg-canvas rounded-md border border-line-light" :class="{'border-success': r.status==='completed'}">
          <div class="flex justify-between mb-2">
            <span class="text-sm font-bold font-mono">R{{ r.roundNo }}</span>
            <span class="text-2xs text-fg-muted" :class="{'!text-success': r.status==='completed'}">
              {{ r.status==='completed'?'已完成':r.status==='in_progress'?'进行中':'待开始' }}
            </span>
          </div>
          <div class="flex items-center justify-center gap-3">
            <template v-if="comboRankings">
              <template v-for="c in comboRankings.filter(x=>x.roundNo===r.roundNo && x.perspective==='a')" :key="c.label">
                <div class="flex flex-col items-center gap-0.5 min-w-[50px] p-2 rounded-md transition-[background-color] duration-fast" :class="{'s4-winner-bg': c.matchWon && r.status==='completed'}">
                  <span v-for="id in c.teamA" :key="id" class="text-sm font-medium" :class="{'!font-bold !text-badge-gold': c.matchWon && r.status==='completed'}">{{ rankings?.find(p=>p.id===id)?.name || id }}</span>
                </div>
                <span class="text-xs text-fg-muted font-bold shrink-0">VS</span>
                <div class="flex flex-col items-center gap-0.5 min-w-[50px] p-2 rounded-md transition-[background-color] duration-fast" :class="{'s4-winner-bg': !c.matchWon && r.status==='completed'}">
                  <span v-for="id in c.teamB" :key="id" class="text-sm font-medium" :class="{'!font-bold !text-badge-gold': !c.matchWon && r.status==='completed'}">{{ rankings?.find(p=>p.id===id)?.name || id }}</span>
                </div>
              </template>
            </template>
            <span v-else class="text-fg-muted text-sm">待生成</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Combined Rankings Panel -->
    <div class="bg-surface rounded-lg border border-line-light">
      <div class="px-3 pt-3">
        <SegmentedControl v-model="rankTab" :options="rankTabOptions" variant="underline" size="sm" />
      </div>

      <!-- Individual rankings -->
      <div v-if="rankTab==='individual'" class="p-3 pt-2">
        <div v-if="sorted.length===0" class="text-center py-12 text-fg-muted text-sm">星尘待亮</div>
        <div v-else class="flex flex-col gap-2">
          <div v-for="(r,i) in sorted" :key="r.id" class="flex flex-col">
            <RankingRow
              :rank="i+1"
              :name="r.name"
              :avatar="r.avatar"
              :score="r.stars || 0"
              score-label="星尘"
            >
              <template #detail>
                <div class="flex gap-1 flex-wrap mt-1">
                  <span v-if="r.pauseCards>0" class="text-2xs px-1.5 rounded-full s4-pause">暂停卡×{{ r.pauseCards }}</span>
                  <span v-if="r.pendingFirst11Count>0" class="text-2xs px-1.5 rounded-full s4-first11">11分待记×{{ r.pendingFirst11Count }}</span>
                </div>
              </template>
            </RankingRow>
          </div>
        </div>
      </div>

      <!-- Combo rankings -->
      <div v-if="rankTab==='combo'" class="p-3 pt-2">
        <div v-if="!comboRankings||comboRankings.length===0" class="text-center py-12 text-fg-muted text-sm">组合待定</div>
        <div v-else class="flex flex-col gap-2">
          <div
            v-for="(c,i) in comboRankings"
            :key="c.label"
            class="flex items-center gap-3 px-4 py-3 rounded-lg border"
            :class="{
              's4-combo-gold border-accent/30': i===0,
              's4-combo-silver border-line': i===1,
              's4-combo-bronze border-line': i===2,
              'bg-surface border-line-light': i > 2
            }"
          >
            <RankMedal v-if="i<3" :rank="i+1" />
            <span v-else class="text-sm font-bold font-mono text-fg-muted w-6 text-center">{{ i+1 }}</span>
            <span class="text-sm font-bold font-mono text-accent min-w-8">{{ getComboLabel(c) }}</span>
            <div class="flex-1 min-w-0">
              <span class="block text-sm font-semibold">{{ getComboPlayers(c.teamA) }} vs {{ getComboPlayers(c.teamB) }}</span>
              <span class="block text-xs text-fg-muted mt-0.5">{{ c.matchWon ? '胜' : (c.roundStatus==='completed'?'负':'待打') }} · {{ c.totalPoints || 0 }}分</span>
            </div>
            <span class="text-sm font-bold text-accent">✦{{ c.stars || 0 }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

/* Combo winner card gradient */
.s4-winner-bg {
  background: linear-gradient(135deg, oklch(0.88 0.12 85 / 0.3), oklch(0.92 0.08 85 / 0.1));
}

/* Badge accents */
.s4-pause {
  background: oklch(0.70 0.12 250 / 0.15);
  color: oklch(0.50 0.12 250);
}
.s4-first11 {
  background: oklch(0.65 0.15 40 / 0.15);
  color: oklch(0.50 0.15 40);
}

/* Combo ranking medal backgrounds */
.s4-combo-gold {
  background: linear-gradient(135deg, oklch(0.85 0.12 85 / 0.25), oklch(0.90 0.08 85 / 0.10));
}
.s4-combo-silver {
  background: linear-gradient(135deg, oklch(0.75 0.02 220 / 0.15), oklch(0.80 0.01 220 / 0.05));
}
.s4-combo-bronze {
  background: linear-gradient(135deg, oklch(0.65 0.06 45 / 0.15), oklch(0.70 0.04 45 / 0.05));
}
</style>
