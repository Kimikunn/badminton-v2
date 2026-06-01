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
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import BookingCalendar from '@/components/venue/BookingCalendar.vue'
import { ClipboardList, Pencil, Trash2 } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const bookingsStore = useBookingsStore()
const playersStore = usePlayersStore()
const venuesStore = useVenuesStore()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

// === Pricing helpers ===
const DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

function pricingLabel(venue) {
  const p = venue?.pricing
  if (!Array.isArray(p) || !p.length) return ''
  const rates = p.map(s => s.rate).filter(r => typeof r === 'number')
  if (!rates.length) return ''
  const lo = Math.min(...rates), hi = Math.max(...rates)
  return lo === hi ? `¥${lo}/h` : `¥${lo}~${hi}/h`
}

function matchPricing(venue, dateStr, startHour, endHour) {
  const p = venue?.pricing
  if (!Array.isArray(p) || !p.length) return 0
  const sh = parseInt(startHour, 10), eh = parseInt(endHour, 10)
  if (isNaN(sh) || isNaN(eh) || eh <= sh) return 0
  let dow = 7
  try { const d = new Date(dateStr + 'T12:00:00'); dow = d.getDay() || 7 } catch {}
  for (const slot of p) {
    const days = slot.days || [1,2,3,4,5,6,7]
    if (days.includes(dow) && sh >= (slot.startHour || 0) && eh <= (slot.endHour || 24)) return slot.rate || 0
  }
  for (const slot of p) {
    if ((slot.days || [1,2,3,4,5,6,7]).includes(dow)) return slot.rate || 0
  }
  return 0
}

function slotDaysLabel(days) {
  if (!days || !days.length) return '每天'
  const sorted = [...days].sort()
  const key = sorted.join(',')
  if (key === '1,2,3,4,5') return '工作日'
  if (key === '6,7') return '周末'
  if (key === '1,2,3,4,5,6,7') return '每天'
  return sorted.map(d => DAY_NAMES[d]).join('、')
}

// Auto-compute cost when venue, date, or time changes
const autoCost = computed(() => {
  if (!selectedVenue.value || !form.value.startHour || !form.value.endHour) return 0
  const rate = matchPricing(selectedVenue.value, form.value.date, form.value.startHour, form.value.endHour)
  const hours = Math.max(parseInt(form.value.endHour) - parseInt(form.value.startHour), 1)
  return rate * hours
})

// === Record view mode ===
const recordViewMode = ref('calendar')
const recordViewOptions = [
  { key: 'calendar', label: '日历' },
  { key: 'list', label: '列表' }
]

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
const form = ref({ date: new Date().toISOString().slice(0,10), startHour: '20', endHour: '21', cost: 45, notes: '', venueId: '' })
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
      startTime: `${String(form.value.startHour).padStart(2, '0')}:00`,
      endTime: `${String(form.value.endHour).padStart(2, '0')}:00`,
      cost: autoCost.value || form.value.cost,
      notes: form.value.notes
    })
    toast.show('已保存', 'success')
    showAdd.value = false
    form.value = { date: new Date().toISOString().slice(0,10), startHour: '20', endHour: '21', cost: 0, notes: '', venueId: '' }
  } catch { toast.show('失败', 'error') }
  saving.value = false
}

function openAdd() {
  form.value.venueId = venuesStore.venues[0]?.id || ''
  form.value.cost = 0
  showAdd.value = true
}

// === Edit/Delete record ===
const editingRecord = ref(null)
const editForm = ref({})
const showEdit = ref(false)

function openEdit(rec) {
  editingRecord.value = rec
  editForm.value = {
    date: rec.date,
    startHour: String(parseInt((rec.startTime || '').split(':')[0] || '20')),
    endHour: String(parseInt((rec.endTime || '').split(':')[0] || '21')),
    cost: rec.cost, notes: rec.notes || '', venueId: rec.venueId
  }
  showEdit.value = true
}

const editAutoCost = computed(() => {
  if (!editForm.value.venueId || !editForm.value.startHour || !editForm.value.endHour) return 0
  const v = venuesStore.venues.find(v => v.id === editForm.value.venueId)
  if (!v) return 0
  const rate = matchPricing(v, editForm.value.date, editForm.value.startHour, editForm.value.endHour)
  const hours = Math.max(parseInt(editForm.value.endHour) - parseInt(editForm.value.startHour), 1)
  return rate * hours
})

async function saveEdit() {
  try {
    const payload = {
      ...editForm.value,
      startTime: `${String(editForm.value.startHour).padStart(2, '0')}:00`,
      endTime: `${String(editForm.value.endHour).padStart(2, '0')}:00`
    }
    delete payload.startHour
    delete payload.endHour
    await bookingsStore.updateRecord(editingRecord.value.id, payload)
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
const venueForm = ref({ name: '', address: '', pricing: [], notes: '' })

function pricingSlot() {
  return { startHour: 8, endHour: 22, rate: 55, days: [1, 2, 3, 4, 5] }
}

function openAddVenue() {
  editingVenue.value = null
  venueForm.value = { name: '', address: '', pricing: [pricingSlot()], notes: '' }
  showVenueSheet.value = true
}

function openEditVenue(v) {
  editingVenue.value = v
  venueForm.value = {
    name: v.name, address: v.address || '',
    pricing: (v.pricing && v.pricing.length) ? v.pricing.map(s => ({ ...s })) : [pricingSlot()],
    notes: v.notes || ''
  }
  showVenueSheet.value = true
}

function addPricingSlot() {
  venueForm.value.pricing.push(pricingSlot())
}

function removePricingSlot(idx) {
  if (venueForm.value.pricing.length <= 1) return
  venueForm.value.pricing.splice(idx, 1)
}

function setSlotDays(slot, preset) {
  if (preset === 'workday') slot.days = [1, 2, 3, 4, 5]
  else if (preset === 'weekend') slot.days = [6, 7]
  else slot.days = [1, 2, 3, 4, 5, 6, 7]
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
          <span class="text-sm font-semibold text-accent">{{ pricingLabel(v) }}</span>
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
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">订场记录</h3>
        <SegmentedControl v-if="bookingsStore.records.length" v-model="recordViewMode" :options="recordViewOptions" size="sm" />
      </div>
      <EmptyState v-if="!bookingsStore.records.length" icon="ClipboardList" title="暂无记录" />

      <!-- List view -->
      <div v-else-if="recordViewMode === 'list'" class="flex flex-col">
        <div v-for="r in bookingsStore.records" :key="r.id" class="flex items-center gap-2 py-2 border-b border-line-light last:border-b-0">
          <div class="flex-1 flex items-center gap-3 cursor-pointer active:opacity-70" @click="openEdit(r)">
            <div class="flex flex-col min-w-12">
              <span class="text-xs font-medium text-fg">{{ r.date?.slice(5) }}</span>
              <span class="text-2xs text-fg-muted">{{ r.startTime }}-{{ r.endTime }}</span>
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

      <!-- Calendar view -->
      <BookingCalendar
        v-else
        :records="bookingsStore.records"
        :get-player-name="(id) => playersStore.getPlayerName(id)"
        :get-player-avatar="(id) => playersStore.getPlayerById(id)?.avatar"
        @create-booking="(date) => { form.date = date; openAdd() }"
      />
    </Card>

    <!-- Add record sheet -->
    <Sheet :show="showAdd" title="新增订场记录" @close="showAdd=false">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">场地</label>
          <select v-model="form.venueId" class="f-select">
            <option v-for="v in venuesStore.venues" :key="v.id" :value="v.id">{{ v.name }}（{{ pricingLabel(v) }}）</option>
          </select>
        </div>
        <Input label="日期" type="date" v-model="form.date" />
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="block text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-1">开始</label>
            <select v-model="form.startHour" class="f-select"><option v-for="h in 14" :key="h" :value="String(h+7)">{{ h+7 }}:00</option></select>
          </div>
          <span class="pb-2 text-sm text-fg-muted">至</span>
          <div class="flex-1">
            <label class="block text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-1">结束</label>
            <select v-model="form.endHour" class="f-select"><option v-for="h in 14" :key="h" :value="String(h+8)">{{ h+8 }}:00</option></select>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">费用</label>
          <div class="flex items-center gap-2">
            <span class="text-lg font-semibold text-accent">¥{{ autoCost || form.cost || '—' }}</span>
            <span class="text-xs text-fg-muted" v-if="autoCost">（按定价自动匹配）</span>
          </div>
        </div>
        <Input label="备注" v-model="form.notes" placeholder="代付等" />
        <Button variant="primary" size="md" block :loading="saving" @click="addRecord">保存</Button>
      </div>
    </Sheet>

    <!-- Edit record sheet -->
    <Sheet :show="showEdit" title="编辑记录" @close="showEdit=false">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">场地</label>
          <select v-model="editForm.venueId" class="f-select">
            <option v-for="v in venuesStore.venues" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select>
        </div>
        <Input label="日期" type="date" v-model="editForm.date" />
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="block text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-1">开始</label>
            <select v-model="editForm.startHour" class="f-select"><option v-for="h in 14" :key="h" :value="String(h+7)">{{ h+7 }}:00</option></select>
          </div>
          <span class="pb-2 text-sm text-fg-muted">至</span>
          <div class="flex-1">
            <label class="block text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-1">结束</label>
            <select v-model="editForm.endHour" class="f-select"><option v-for="h in 14" :key="h" :value="String(h+8)">{{ h+8 }}:00</option></select>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">费用</label>
          <div class="flex items-center gap-2">
            <span class="text-lg font-semibold text-accent">¥{{ editAutoCost || editForm.cost || '—' }}</span>
            <span class="text-xs text-fg-muted" v-if="editAutoCost">（按定价自动匹配）</span>
          </div>
        </div>
        <Input label="备注" v-model="editForm.notes" />
        <Button variant="primary" size="md" block @click="saveEdit">保存修改</Button>
      </div>
    </Sheet>

    <!-- Venue form sheet -->
    <Sheet :show="showVenueSheet" :title="editingVenue ? '编辑场地' : '新增场地'" @close="showVenueSheet=false">
      <div class="flex flex-col gap-4">
        <Input label="名称" v-model="venueForm.name" placeholder="如: 川沙体育馆" />
        <Input label="地址" v-model="venueForm.address" placeholder="详细地址" />

        <!-- Pricing slots -->
        <div>
          <label class="block text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-1">价格配置</label>
          <div class="flex flex-col gap-2 mt-1">
            <div
              v-for="(slot, idx) in venueForm.pricing"
              :key="idx"
              class="flex items-center gap-2 py-2 border-b border-line-light last:border-b-0"
            >
              <select class="f-select !w-auto flex-1 min-w-0" @change="setSlotDays(slot, $event.target.value)">
                <option value="workday" :selected="(slot.days||[]).join(',')==='1,2,3,4,5'">工作日</option>
                <option value="weekend" :selected="(slot.days||[]).join(',')==='6,7'">周末</option>
                <option value="everyday" :selected="(slot.days||[]).join(',')==='1,2,3,4,5,6,7'">每天</option>
              </select>
              <select v-model="slot.startHour" class="f-select !w-auto min-w-0">
                <option v-for="h in 24" :key="h" :value="h-1" :disabled="h-1>=slot.endHour">{{ String(h-1).padStart(2,'0') }}:00</option>
              </select>
              <span class="text-xs text-fg-muted shrink-0">至</span>
              <select v-model="slot.endHour" class="f-select !w-auto min-w-0">
                <option v-for="h in 24" :key="h" :value="h" :disabled="h<=slot.startHour">{{ String(h).padStart(2,'0') }}:00</option>
              </select>
              <div class="flex items-center gap-1 shrink-0">
                <span class="text-xs text-fg-muted">¥</span>
                <input v-model.number="slot.rate" type="number" class="w-16 p-1.5 bg-canvas border border-line rounded-lg text-sm text-fg text-center outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast" min="0" max="9999" />
              </div>
              <button
                v-if="venueForm.pricing.length > 1"
                class="w-6 h-6 flex items-center justify-center rounded-full text-fg-muted active:text-danger active:bg-danger-subtle transition-colors shrink-0"
                @click="removePricingSlot(idx)"
              >×</button>
            </div>
          </div>
          <button class="text-xs text-accent mt-1.5 active:opacity-70" @click="addPricingSlot">+ 添加时段</button>
        </div>

        <Input label="备注" v-model="venueForm.notes" />
        <Button variant="primary" size="md" block @click="saveVenue">保存</Button>
        <Button v-if="editingVenue" variant="danger" size="md" block @click="deleteEditingVenue" class="mt-2">删除场地</Button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
/* Shared icon button — matches PlayerDetailView */
.icon-btn { @apply w-7 h-7 border-none rounded-full bg-surface-hover text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast active:scale-90; }
.icon-btn:hover { @apply bg-accent-subtle text-accent; }

/* Native select — needs appearance:none and custom chevron */
.f-select { @apply w-full p-2.5 pl-3 bg-canvas border border-line rounded-lg text-base text-fg appearance-none focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast ease-out; }
</style>
