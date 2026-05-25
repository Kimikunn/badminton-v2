<script setup>
/**
 * S1Rankings — 标准规则积分榜
 * Contract: { id, name, avatar, bigScore, smallScore, totalPoints, wins, losses, finalBigScore, finalSmallScore }
 */
import { computed, ref } from 'vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import RankingRow from '@/components/ui/RankingRow.vue'

const props = defineProps({ rankings: Array })
const tab = ref('big')

const tabOptions = [
  { key: 'big', label: '胜场大分' },
  { key: 'small', label: '场获小分' },
  { key: 'total', label: '进球总数' }
]

const sorted = computed(() => {
  const arr = [...props.rankings]
  if (tab.value === 'big') return arr.sort((a,b)=>(b.finalBigScore??b.bigScore??0)-(a.finalBigScore??a.bigScore??0))
  if (tab.value === 'small') return arr.sort((a,b)=>(b.finalSmallScore??b.smallScore??0)-(a.finalSmallScore??a.smallScore??0))
  return arr.sort((a,b)=>(b.totalPoints??0)-(a.totalPoints??0))
})

function getScore(r) {
  if (tab.value === 'big') return r.finalBigScore ?? r.bigScore ?? 0
  if (tab.value === 'small') return r.finalSmallScore ?? r.smallScore ?? 0
  return r.totalPoints ?? 0
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <SegmentedControl v-model="tab" :options="tabOptions" />
    <div v-if="!sorted.length" class="text-center py-12 text-fg-muted text-sm">暂无数据</div>
    <div v-else class="flex flex-col gap-2">
      <RankingRow
        v-for="(r, i) in sorted"
        :key="r.id"
        :rank="i + 1"
        :name="r.name"
        :avatar="r.avatar"
        :detail="`${r.wins ?? 0}胜 ${r.losses ?? 0}负`"
        :score="getScore(r)"
      />
    </div>
  </div>
</template>
