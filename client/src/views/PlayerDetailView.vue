<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayersStore, useMatchesStore, useTitlesStore, useSeasonsStore } from '@/stores'
import { STATUS, TITLE_LEVELS } from '@/constants'
import Card from '@/components/ui/Card.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { User, Award, ArrowLeft, Pencil, Trash2, Camera } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'

const route = useRoute()
const router = useRouter()
const playersStore = usePlayersStore()
const matchesStore = useMatchesStore()
const titlesStore = useTitlesStore()
const seasonsStore = useSeasonsStore()
const toast = useToast()

const playerId = computed(() => route.params.id)
const player = computed(() => playersStore.getPlayerById(playerId.value))
const playerTitles = computed(() => titlesStore.getPlayerTitles(playerId.value))

// Displayed title
const displayedTitle = computed(() => {
  if (!player.value?.displayedTitleId) return titlesStore.getHighestTitle(playerId.value)
  return titlesStore.allTitles.find(t => t.id === player.value.displayedTitleId) || titlesStore.getHighestTitle(playerId.value)
})

// Stats
const playerStats = computed(() => {
  if (!player.value) return null
  const allMatches = matchesStore.allMatches.filter(m =>
    m.status === STATUS.COMPLETED &&
    (m.teamA?.includes(playerId.value) || m.teamB?.includes(playerId.value))
  )
  let wins = 0, losses = 0, totalPoints = 0, gameWins = 0
  for (const m of allMatches) {
    const isA = m.teamA?.includes(playerId.value)
    const isB = m.teamB?.includes(playerId.value)
    if ((isA && m.winner === 'a') || (isB && m.winner === 'b')) wins++
    else if (m.winner) losses++
    const gs = matchesStore.getGamesByMatch(m.id)
    for (const g of gs) {
      if (g.status !== STATUS.COMPLETED) continue
      if (isA) { totalPoints += g.scoreA || 0; if (g.winner === 'a') gameWins++ }
      else if (isB) { totalPoints += g.scoreB || 0; if (g.winner === 'b') gameWins++ }
    }
  }
  return { wins, losses, totalPoints, gameWins, totalMatches: allMatches.length }
})

// Equipment
const rackets = ref([])
const shoes = ref([])
const initEquipment = () => {
  rackets.value = player.value?.racket ? String(player.value.racket).split(',').filter(Boolean) : []
  shoes.value = player.value?.shoes ? String(player.value.shoes).split(',').filter(Boolean) : []
}
watch(player, initEquipment, { immediate: true })

// Edit name
const showEditSheet = ref(false)
const editForm = ref({ name: '' })
function openEdit() {
  if (!player.value) return
  editForm.value = { name: player.value.name }
  showEditSheet.value = true
}
async function saveEdit() {
  try {
    await playersStore.updatePlayer(playerId.value, editForm.value)
    toast.show('已保存', 'success')
    showEditSheet.value = false
  } catch { toast.show('保存失败', 'error') }
}

// Avatar upload
const avatarInput = ref(null)
function triggerAvatarUpload() { avatarInput.value?.click() }
async function handleAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const res = await api.post('/upload/avatar', { image: reader.result })
      if (res.success) {
        await playersStore.updatePlayer(playerId.value, { avatar: res.data.url })
        toast.show('头像已更新', 'success')
      }
    } catch { toast.show('上传失败', 'error') }
  }
  reader.readAsDataURL(file)
}

// Set displayed title
async function setDisplayedTitle(titleId) {
  try {
    await playersStore.updatePlayer(playerId.value, { displayedTitleId: titleId })
    toast.show('已设为展示称号', 'success')
  } catch { toast.show('设置失败', 'error') }
}

// Equipment management
const newRacket = ref('')
const newShoe = ref('')
const addingRacket = ref(false)
const addingShoe = ref(false)
const editingRacket = ref(-1)
const editingShoe = ref(-1)
const editRacketVal = ref('')
const editShoeVal = ref('')

function startAddRacket() { addingRacket.value = true }
function startAddShoe() { addingShoe.value = true }
function startEditRacket(i) { editingRacket.value = i; editRacketVal.value = rackets.value[i] }
function startEditShoe(i) { editingShoe.value = i; editShoeVal.value = shoes.value[i] }

async function saveRacketEdit(i) {
  if (!editRacketVal.value.trim()) return
  rackets.value[i] = editRacketVal.value.trim(); editingRacket.value = -1; await saveEquipment()
}
async function saveShoeEdit(i) {
  if (!editShoeVal.value.trim()) return
  shoes.value[i] = editShoeVal.value.trim(); editingShoe.value = -1; await saveEquipment()
}
async function addRacket() {
  if (!newRacket.value.trim()) return
  rackets.value.push(newRacket.value.trim()); await saveEquipment(); newRacket.value = ''; addingRacket.value = false
}
async function addShoe() {
  if (!newShoe.value.trim()) return
  shoes.value.push(newShoe.value.trim()); await saveEquipment(); newShoe.value = ''; addingShoe.value = false
}
async function removeRacket(idx) { rackets.value.splice(idx, 1); await saveEquipment() }
async function removeShoe(idx) { shoes.value.splice(idx, 1); await saveEquipment() }
async function saveEquipment() {
  await playersStore.updatePlayer(playerId.value, { racket: rackets.value.join(','), shoes: shoes.value.join(',') })
}

function goBack() { router.back() }
function getTitleLevelVariant(level) {
  const map = { S: 'gold', A: 'purple', B: 'blue', C: 'green', hidden: 'muted' }
  return map[level] || 'muted'
}
</script>

<template>
  <div class="p-4 flex flex-col gap-4">
    <button aria-label="返回" class="w-9 h-9 rounded-full bg-surface-hover text-fg-secondary flex items-center justify-center cursor-pointer border-none transition-all duration-fast active:scale-90" @click="goBack">
      <ArrowLeft :size="20" />
    </button>

    <EmptyState v-if="!player" icon="User" title="选手未找到" />

    <template v-else>
      <!-- Profile -->
      <div class="flex items-center gap-4 relative">
        <div class="relative cursor-pointer rounded-full overflow-hidden shrink-0 avatar-wrap" @click="triggerAvatarUpload">
          <Avatar :name="player.name" :src="player.avatar" size="xl" />
          <div class="avatar-overlay"><Camera :size="24" /></div>
        </div>
        <input ref="avatarInput" type="file" accept="image/*" class="hidden" @change="handleAvatarChange" />
        <div class="flex-1 relative">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-xl font-bold text-fg cursor-pointer transition-colors duration-fast hover:text-accent" @click="openEdit">{{ player.name }}</h2>
            <Badge v-if="displayedTitle" :variant="getTitleLevelVariant(displayedTitle.level)" size="sm">{{ displayedTitle.name }}</Badge>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <Card v-if="playerStats" padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-4">战绩统计</h3>
        <div class="grid grid-cols-3 gap-3">
          <div class="text-center p-3 bg-canvas rounded-md">
            <span class="block text-xl font-bold font-mono text-fg">{{ playerStats.totalMatches }}</span>
            <span class="text-xs text-fg-muted mt-0.5">比赛</span>
          </div>
          <div class="text-center p-3 bg-canvas rounded-md">
            <span class="block text-xl font-bold font-mono text-success">{{ playerStats.wins }}</span>
            <span class="text-xs text-fg-muted mt-0.5">胜场</span>
          </div>
          <div class="text-center p-3 bg-canvas rounded-md">
            <span class="block text-xl font-bold font-mono text-danger">{{ playerStats.losses }}</span>
            <span class="text-xs text-fg-muted mt-0.5">负场</span>
          </div>
          <div class="text-center p-3 bg-canvas rounded-md">
            <span class="block text-xl font-bold font-mono text-fg">{{ playerStats.gameWins }}</span>
            <span class="text-xs text-fg-muted mt-0.5">胜局</span>
          </div>
          <div class="text-center p-3 bg-canvas rounded-md">
            <span class="block text-xl font-bold font-mono text-fg">{{ playerStats.totalPoints }}</span>
            <span class="text-xs text-fg-muted mt-0.5">总得分</span>
          </div>
          <div class="text-center p-3 bg-canvas rounded-md">
            <span class="block text-xl font-bold font-mono text-fg">{{ playerStats.totalMatches>0?Math.round(playerStats.wins/playerStats.totalMatches*100):0 }}%</span>
            <span class="text-xs text-fg-muted mt-0.5">胜率</span>
          </div>
        </div>
      </Card>

      <!-- Equipment: Rackets -->
      <Card padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-4">球拍</h3>
        <div class="flex flex-col gap-1">
          <div v-for="(r,i) in rackets" :key="'r'+i" class="flex items-center gap-2 py-2">
            <template v-if="editingRacket===i">
              <input v-model="editRacketVal" class="eq-input" @keyup.enter="saveRacketEdit(i)" />
              <button class="eq-act" @click="saveRacketEdit(i)">确定</button>
              <button class="eq-act eq-cancel" @click="editingRacket=-1">取消</button>
            </template>
            <template v-else>
              <span class="flex-1 text-sm text-fg">{{ r }}</span>
              <button class="eq-icon" @click="startEditRacket(i)" title="编辑"><Pencil :size="14" /></button>
              <button class="eq-icon eq-del" @click="removeRacket(i)" title="删除"><Trash2 :size="14" /></button>
            </template>
          </div>
          <div v-if="addingRacket" class="flex items-center gap-2 py-2">
            <input v-model="newRacket" placeholder="球拍型号" class="eq-input" @keyup.enter="addRacket" />
            <button class="eq-act" @click="addRacket">确定</button>
            <button class="eq-act eq-cancel" @click="addingRacket=false; newRacket=''">取消</button>
          </div>
          <button v-if="!addingRacket" class="eq-add-btn" @click="startAddRacket">+ 添加球拍</button>
        </div>
      </Card>

      <!-- Equipment: Shoes -->
      <Card padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-4">球鞋</h3>
        <div class="flex flex-col gap-1">
          <div v-for="(s,i) in shoes" :key="'s'+i" class="flex items-center gap-2 py-2">
            <template v-if="editingShoe===i">
              <input v-model="editShoeVal" class="eq-input" @keyup.enter="saveShoeEdit(i)" />
              <button class="eq-act" @click="saveShoeEdit(i)">确定</button>
              <button class="eq-act eq-cancel" @click="editingShoe=-1">取消</button>
            </template>
            <template v-else>
              <span class="flex-1 text-sm text-fg">{{ s }}</span>
              <button class="eq-icon" @click="startEditShoe(i)" title="编辑"><Pencil :size="14" /></button>
              <button class="eq-icon eq-del" @click="removeShoe(i)" title="删除"><Trash2 :size="14" /></button>
            </template>
          </div>
          <div v-if="addingShoe" class="flex items-center gap-2 py-2">
            <input v-model="newShoe" placeholder="球鞋型号" class="eq-input" @keyup.enter="addShoe" />
            <button class="eq-act" @click="addShoe">确定</button>
            <button class="eq-act eq-cancel" @click="addingShoe=false; newShoe=''">取消</button>
          </div>
          <button v-if="!addingShoe" class="eq-add-btn" @click="startAddShoe">+ 添加球鞋</button>
        </div>
      </Card>

      <!-- Titles -->
      <Card padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-4">称号 ({{ playerTitles.length }})</h3>
        <EmptyState v-if="playerTitles.length===0" icon="Award" title="暂无称号" />
        <div v-else class="flex flex-col gap-2">
          <div v-for="title in playerTitles" :key="title.id" class="flex items-center gap-3 py-2 border-b border-line-light last:border-b-0"
            :class="{'bg-accent-subtle -mx-2 px-2 rounded-sm !border-b-0':displayedTitle?.id===title.id}">
            <Badge :variant="getTitleLevelVariant(title.level)" size="md">{{ TITLE_LEVELS[title.level]?.label || title.level }}</Badge>
            <span class="text-sm font-medium text-fg flex-1">{{ title.name }}</span>
            <button v-if="displayedTitle?.id!==title.id" class="title-set" @click="setDisplayedTitle(title.id)">设为展示</button>
            <span v-else class="text-xs text-success font-medium">展示中</span>
          </div>
        </div>
      </Card>
    </template>

    <!-- Edit sheet -->
    <Sheet :show="showEditSheet" title="编辑资料" @close="showEditSheet=false">
      <div class="flex flex-col gap-4">
        <Input label="姓名" v-model="editForm.name" />
        <div class="flex gap-3">
          <Button variant="secondary" size="md" class="flex-1" @click="showEditSheet=false">取消</Button>
          <Button variant="primary" size="md" class="flex-1" @click="saveEdit">保存</Button>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
/* Avatar overlay — needs :hover on parent */
.avatar-overlay { @apply absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 transition-opacity duration-fast; }
.avatar-wrap:hover .avatar-overlay { opacity:1; }

/* Equipment editing */
.eq-input { @apply flex-1 p-1 pl-2 border border-accent rounded-lg bg-canvas text-sm text-fg outline-none; }
.eq-act { @apply px-2.5 py-0.5 border border-accent rounded-lg bg-accent text-fg-inverse text-xs cursor-pointer transition-all duration-fast active:scale-95; }
.eq-act.eq-cancel { @apply bg-transparent text-fg-secondary border-line; }
.eq-icon { @apply w-7 h-7 border-none rounded-full bg-transparent text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast active:scale-90; }
.eq-icon:hover { @apply bg-accent-subtle text-accent; }
.eq-icon.eq-del:hover { @apply bg-danger-subtle text-danger; }
.eq-add-btn { @apply p-2 border border-dashed border-line rounded-lg bg-transparent text-fg-muted text-sm cursor-pointer text-center w-full transition-[transform,border-color] duration-fast active:scale-[0.98]; }

/* Title set button */
.title-set { @apply px-2 py-0.5 border border-accent rounded-lg bg-transparent text-accent text-xs cursor-pointer transition-all duration-fast active:scale-95; }
</style>
