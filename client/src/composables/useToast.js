/**
 * useToast — 轻量通知 composable
 *
 * Usage:
 *   import { useToast } from '@/composables/useToast'
 *   const toast = useToast()
 *   toast.show('保存成功', 'success')
 */
import { ref } from 'vue'

const toasts = ref([])
let idCounter = 0

export function useToast() {
  function show(message, type = 'info', duration = 2500, onClick = null) {
    const id = ++idCounter
    toasts.value.push({ id, message, type, onClick })
    if (duration > 0) {
      setTimeout(() => remove(id), duration)
    }
    return id
  }

  function remove(id) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return { toasts, show, remove }
}
