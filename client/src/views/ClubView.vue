<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClubStore, usePlayersStore, useTitlesStore } from '@/stores'
import Card from '@/components/ui/Card.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Pencil, Dumbbell, Crown, Star, Diamond, Clover, CircleHelp, ChevronRight, Users } from 'lucide-vue-next'

const router = useRouter()
const clubStore = useClubStore()
const playersStore = usePlayersStore()
const titlesStore = useTitlesStore()

const isEditing = ref(false)
const editForm = ref({ name: '', description: '' })

function startEdit() {
  editForm.value = { name: clubStore.club.name, description: clubStore.club.description }
  isEditing.value = true
}

async function saveClub() {
  await clubStore.updateClub(editForm.value)
  isEditing.value = false
}

function getDisplayedTitle(player) {
  return titlesStore.getHighestTitle(player.id)
}

const titleIconMap = { S: Crown, A: Star, B: Diamond, C: Clover, hidden: CircleHelp }
function getTitleIcon(title) {
  if (!title) return null
  return titleIconMap[title.level] || null
}

function goToPlayer(id) {
  router.push({ name: 'player-detail', params: { id } })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Club info -->
    <Card padding="md">
      <template v-if="!isEditing">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 flex items-center justify-center shrink-0 rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-avatar-fallback-end))] text-fg-inverse"><Dumbbell :size="28" /></div>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold">{{ clubStore.club.name }}</h2>
            <p class="text-sm text-fg-secondary mt-0.5">{{ clubStore.club.description || '暂无介绍' }}</p>
          </div>
          <button class="w-9 h-9 flex items-center justify-center border-none rounded-full bg-surface-hover text-fg-muted cursor-pointer shrink-0" @click="startEdit">
            <Pencil :size="16" />
          </button>
        </div>
      </template>
      <template v-else>
        <Input label="俱乐部名称" v-model="editForm.name" />
        <Input label="俱乐部介绍" type="textarea" v-model="editForm.description" rows="2" class="mt-3" />
        <div class="flex gap-2 mt-3">
          <Button variant="secondary" size="sm" class="flex-1" @click="isEditing = false">取消</Button>
          <Button variant="primary" size="sm" class="flex-1" @click="saveClub">保存</Button>
        </div>
      </template>
    </Card>

    <!-- Members -->
    <Card padding="md">
      <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-3">成员 ({{ playersStore.players.length }})</h3>

      <EmptyState
        v-if="playersStore.players.length === 0"
        icon="Users"
        title="暂无成员"
        description="在成员页面中添加俱乐部成员"
      />

      <div v-else class="flex flex-col">
        <div
          v-for="player in playersStore.players"
          :key="player.id"
          class="flex items-center gap-3 py-3 cursor-pointer transition-opacity duration-fast active:opacity-70 border-b border-line-light last:border-b-0"
          @click="goToPlayer(player.id)"
        >
          <Avatar :name="player.name" :src="player.avatar" size="md" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-base font-medium">{{ player.name }}</span>
              <component v-if="getDisplayedTitle(player) && getTitleIcon(getDisplayedTitle(player))" :is="getTitleIcon(getDisplayedTitle(player))" :size="16" class="text-sm leading-none" :title="getDisplayedTitle(player).name" />
            </div>
            <span class="text-xs text-fg-muted">{{ getDisplayedTitle(player)?.name || '暂无称号' }}</span>
          </div>
          <ChevronRight :size="16" class="text-fg-muted shrink-0" />
        </div>
      </div>
    </Card>
  </div>
</template>
