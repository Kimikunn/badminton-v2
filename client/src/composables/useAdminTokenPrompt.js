import { reactive, readonly } from 'vue'

const state = reactive({
  show: false,
  title: '写入权限',
  message: '请输入写入权限令牌，验证通过后会保存在本机。',
  resolver: null
})

function close(token) {
  const resolve = state.resolver
  state.show = false
  state.resolver = null
  if (resolve) resolve(token || '')
}

export function requestAdminToken(options = {}) {
  if (typeof window === 'undefined') return Promise.resolve('')
  if (state.resolver) close('')
  state.title = options.title || '写入权限'
  state.message = options.message || '请输入写入权限令牌，验证通过后会保存在本机。'
  state.show = true
  return new Promise(resolve => {
    state.resolver = resolve
  })
}

export function useAdminTokenPrompt() {
  return {
    adminTokenPromptState: readonly(state),
    submitAdminToken: (token) => close(String(token || '').trim()),
    cancelAdminToken: () => close('')
  }
}
