<script setup>
/**
 * TitleIcon — resolve title ID to its designated lucide icon.
 */
import { computed } from 'vue'
import { TITLE_ICONS } from '@/constants'
import {
  Trophy, Medal, Award, Crown,
  Bomb, Swords, Fish,
  Sword, Wrench, Target, Snowflake, Sparkles, Goal,
  Shirt, Footprints, Zap, ShoppingCart,
  Skull, SmilePlus, Eye, VolumeX
} from 'lucide-vue-next'

const props = defineProps({ titleId: { type: String, required: true }, size: { type: Number, default: 18 } })

const iconMap = { Trophy, Medal, Award, Crown, Bomb, Swords, Fish, Sword, Wrench, Target, Snowflake, Sparkles, Goal, Shirt, Footprints, Zap, ShoppingCart, Skull, SmilePlus, Eye, VolumeX }
const iconName = computed(() => TITLE_ICONS[props.titleId] || 'Award')
</script>

<template>
  <component :is="iconMap[iconName]" :size="size" />
</template>
