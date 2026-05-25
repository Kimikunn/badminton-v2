import { reactive, readonly } from 'vue'

const defaultOptions = {
  title: '确认操作',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  variant: 'danger'
}

const state = reactive({
  show: false,
  options: { ...defaultOptions },
  resolver: null
})

function close(result) {
  const resolve = state.resolver
  state.show = false
  state.resolver = null
  if (resolve) resolve(result)
}

export function useConfirm() {
  function confirm(options = {}) {
    if (state.resolver) close(false)
    state.options = { ...defaultOptions, ...options }
    state.show = true
    return new Promise(resolve => {
      state.resolver = resolve
    })
  }

  return {
    confirm,
    confirmState: readonly(state),
    resolveConfirm: () => close(true),
    cancelConfirm: () => close(false)
  }
}
