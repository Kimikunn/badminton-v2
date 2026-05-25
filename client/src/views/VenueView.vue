<script setup>
/**
 * VenueView — 场地管理 & 订场
 */
import { ref, computed, onMounted } from 'vue'
import { useBookingsStore, usePlayersStore, useVenuesStore } from '@/stores'
import Card from '@/components/ui/Card.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { ClipboardList, Pencil, Trash2 } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const bookingsStore = useBookingsStore()
const playersStore = usePlayersStore()
const venuesStore = useVenuesStore()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

onMounted(() => { bookingsStore.init(); venuesStore.init() })

// === Rotation ===
const nextPerson = computed(() => {
  const { rotation: rot, currentPersonIndex: idx } = bookingsStore.config
  if (!rot.length) return null
  const pid = rot[idx % rot.length]
  return playersStore.getPlayerById(pid)
})

// === Add record ===
const showAdd = ref(false)
const form = ref({ date: new Date().toISOString().slice(0,10), startTime: '20', endTime: '21', cost: 45, notes: '', venueId: '' })
const saving = ref(false)
const selectedVenue = computed(() => venuesStore.venues.find(v => v.id === form.value.venueId))

async function addRecord() {
  if (!nextPerson.value) return
  if (!form.value.venueId) { toast.show('请选择场地', 'error'); return }
  saving.value = true
  try {
    await bookingsStore.addRecord({
      playerId: nextPerson.value.id,
      venueId: form.value.venueId,
      date: form.value.date,
      time: `${form.value.startTime}:00-${form.value.endTime}:00`,
      cost: selectedVenue.value?.hourlyRate || form.value.cost,
      notes: form.value.notes
    })
    toast.show('已保存', 'success')
    showAdd.value = false
    form.value = { date: new Date().toISOString().slice(0,10), startTime: '20', endTime: '21', cost: 45, notes: '', venueId: '' }
  } catch { toast.show('失败', 'error') }
  saving.value = false
}

function openAdd() {
  form.value.venueId = venuesStore.venues[0]?.id || ''
  form.value.cost = venuesStore.venues[0]?.hourlyRate || 45
  showAdd.value = true
}

// === Edit/Delete record ===
const editingRecord = ref(null)
const editForm = ref({})
const showEdit = ref(false)

function openEdit(rec) {
  editingRecord.value = rec
  editForm.value = { date: rec.date, time: rec.time, cost: rec.cost, notes: rec.notes || '', venueId: rec.venueId }
  showEdit.value = true
}

async function saveEdit() {
  try {
    await bookingsStore.updateRecord(editingRecord.value.id, editForm.value)
    toast.show('已更新', 'success')
    showEdit.value = false
  } catch { toast.show('失败', 'error') }
}

async function deleteRecord(rec) {
  const ok = await confirmAction({
    title: '删除订场记录',
    message: `确认删除 ${rec.date} 的订场记录？`,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await bookingsStore.deleteRecord(rec.id)
    toast.show('已删除', 'success')
  } catch { toast.show('失败', 'error') }
}

// === Venue CRUD ===
const showVenueSheet = ref(false)
const editingVenue = ref(null)
const venueForm = ref({ name: '', address: '', hourlyRate: 0, notes: '' })

function openAddVenue() {
  editingVenue.value = null
  venueForm.value = { name: '', address: '', hourlyRate: 0, notes: '' }
  showVenueSheet.value = true
}

function openEditVenue(v) {
  editingVenue.value = v
  venueForm.value = { name: v.name, address: v.address || '', hourlyRate: v.hourlyRate || 0, notes: v.notes || '' }
  showVenueSheet.value = true
}

async function saveVenue() {
  try {
    if (editingVenue.value) {
      await venuesStore.updateVenue(editingVenue.value.id, venueForm.value)
    } else {
      await venuesStore.createVenue(venueForm.value)
    }
    toast.show('已保存', 'success')
    showVenueSheet.value = false
  } catch { toast.show('失败', 'error') }
}

async function deleteVenue(v) {
  const ok = await confirmAction({
    title: '删除场地',
    message: `确认删除场地「${v.name}」？`,
    confirmText: '删除'
  })
  if (!ok) return false
  try {
    await venuesStore.deleteVenue(v.id)
    toast.show('已删除', 'success')
    return true
  } catch {
    toast.show('失败', 'error')
    return false
  }
}

async function deleteEditingVenue() {
  if (!editingVenue.value) return
  const deleted = await deleteVenue(editingVenue.value)
  if (deleted) showVenueSheet.value = false
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Venues -->
    <Card padding="md">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-3">场地</h3>
        <Button variant="ghost" size="sm" @click="openAddVenue">+ 新增</Button>
      </div>
      <div v-if="venuesStore.venues.length === 0">
        <EmptyState icon="MapPin" title="暂无场地" description="添加常用场地" />
      </div>
      <div v-else class="flex flex-col">
        <div v-for="v in venuesStore.venues" :key="v.id" class="flex items-center gap-2 py-2 border-b border-line-light last:border-b-0">
          <div class="flex-1 min-w-0">
            <span class="text-sm font-medium text-fg">{{ v.name }}</span>
            <span class="block text-2xs text-fg-muted" v-if="v.address">{{ v.address }}</span>
          </div>
          <span class="text-sm font-semibold text-accent">¥{{ v.hourlyRate }}/h</span>
          <button class="icon-btn" @click="openEditVenue(v)" title="编辑">
            <Pencil :size="14" />
          </button>
          <button class="icon-btn !text-danger" @click="deleteVenue(v)" title="删除">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
    </Card>

    <!-- Rotation + Add -->
    <Card padding="md">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-3">订场轮换</h3>
          <p class="text-sm text-fg-secondary mt-0.5" v-if="nextPerson">下一个：<strong class="text-accent">{{ nextPerson.name }}</strong></p>
        </div>
        <Avatar v-if="nextPerson" :name="nextPerson.name" :src="nextPerson.avatar" size="lg" />
      </div>
      <Button variant="primary" size="md" block @click="openAdd" class="mt-3">
        <ClipboardList :size="16" class="inline mr-1" />{{ nextPerson ? nextPerson.name + ' 记录订场' : '新增记录' }}
      </Button>
    </Card>

    <!-- Records -->
    <Card padding="md">
      <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-3">订场记录</h3>
      <EmptyState v-if="!bookingsStore.records.length" icon="ClipboardList" title="暂无记录" />
      <div v-else class="flex flex-col">
        <div v-for="r in bookingsStore.records" :key="r.id" class="flex items-center gap-2 py-2 border-b border-line-light last:border-b-0">
          <div class="flex-1 flex items-center gap-3 cursor-pointer active:opacity-70" @click="openEdit(r)">
            <div class="flex flex-col min-w-12">
              <span class="text-xs font-medium text-fg">{{ r.date?.slice(5) }}</span>
              <span class="text-2xs text-fg-muted">{{ r.time }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-sm text-fg">{{ playersStore.getPlayerName(r.playerId) }}</span>
              <span class="block text-2xs text-fg-muted">{{ r.venueName || '—' }}</span>
              <span class="block text-2xs text-warning" v-if="r.notes">{{ r.notes }}</span>
            </div>
            <span class="text-sm font-semibold text-accent">¥{{ r.cost }}</span>
          </div>
          <button class="icon-btn !text-danger" @click.stop="deleteRecord(r)" title="删除">
            <Trash2 :size="12" />
          </button>
        </div>
      </div>
    </Card>

    <!-- Add record sheet -->
    <Sheet :show="showAdd" title="新增订场记录" @close="showAdd=false">
      <div class="flex flex-col gap-4">
        <div class="form-group">
          <label class="form-label">场地</label>
          <select v-model="form.venueId" class="f-select" @change="form.cost = selectedVenue?.hourlyRate || 45">
            <option v-for="v in venuesStore.venues" :key="v.id" :value="v.id">{{ v.name }} (¥{{ v.hourlyRate }}/h)</option>
          </select>
        </div>
        <Input label="日期" type="date" v-model="form.date" />
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="form-label">开始</label>
            <select v-model="form.startTime" class="f-select"><option v-for="h in 14" :key="h" :value="String(h+7)">{{ h+7 }}:00</option></select>
          </div>
          <span class="pb-2 text-sm text-fg-muted">至</span>
          <div class="flex-1">
            <label class="form-label">结束</label>
            <select v-model="form.endTime" class="f-select"><option v-for="h in 14" :key="h" :value="String(h+8)">{{ h+8 }}:00</option></select>
          </div>
        </div>
        <Input label="费用" v-model.number="form.cost" type="number" />
        <Input label="备注" v-model="form.notes" placeholder="代付等" />
        <Button variant="primary" size="md" block :loading="saving" @click="addRecord">保存</Button>
      </div>
    </Sheet>

    <!-- Edit record sheet -->
    <Sheet :show="showEdit" title="编辑记录" @close="showEdit=false">
      <div class="flex flex-col gap-4">
        <div class="form-group">
          <label class="form-label">场地</label>
          <select v-model="editForm.venueId" class="f-select">
            <option v-for="v in venuesStore.venues" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select>
        </div>
        <Input label="日期" type="date" v-model="editForm.date" />
        <Input label="时间段" v-model="editForm.time" />
        <Input label="费用" v-model.number="editForm.cost" type="number" />
        <Input label="备注" v-model="editForm.notes" />
        <Button variant="primary" size="md" block @click="saveEdit">保存修改</Button>
      </div>
    </Sheet>

    <!-- Venue form sheet -->
    <Sheet :show="showVenueSheet" :title="editingVenue ? '编辑场地' : '新增场地'" @close="showVenueSheet=false">
      <div class="flex flex-col gap-4">
        <Input label="名称" v-model="venueForm.name" placeholder="如: 川沙体育馆" />
        <Input label="地址" v-model="venueForm.address" placeholder="详细地址" />
        <Input label="时租 (元)" v-model.number="venueForm.hourlyRate" type="number" />
        <Input label="备注" v-model="venueForm.notes" />
        <Button variant="primary" size="md" block @click="saveVenue">保存</Button>
        <Button v-if="editingVenue" variant="danger" size="md" block @click="deleteEditingVenue" class="mt-2">删除场地</Button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
/* Shared UI patterns that need pseudo-selectors or can't be inline */
.icon-btn { @apply w-7 h-7 border-none rounded-full bg-surface-hover text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast active:scale-90; }
.icon-btn:hover { @apply bg-accent-subtle text-accent; }

.form-label { @apply block text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-1; }
.f-select { @apply w-full p-2.5 pl-3 bg-canvas border border-line rounded-lg text-base text-fg appearance-none focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast ease-out; }
</style>
