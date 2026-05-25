/**
 * API Client — 统一 HTTP 请求封装
 */
import axios from 'axios'
import { requestAdminToken } from '@/composables/useAdminTokenPrompt'

const ADMIN_TOKEN_KEY = 'badclub:adminToken'
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete'])

function getStoredAdminToken() {
  if (typeof window === 'undefined') return import.meta.env.VITE_ADMIN_TOKEN || ''
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || import.meta.env.VITE_ADMIN_TOKEN || ''
}

function setStoredAdminToken(token) {
  if (typeof window === 'undefined') return
  const value = String(token || '').trim()
  if (value) window.localStorage.setItem(ADMIN_TOKEN_KEY, value)
  else window.localStorage.removeItem(ADMIN_TOKEN_KEY)
}

function isWriteRequest(config = {}) {
  return WRITE_METHODS.has(String(config.method || '').toLowerCase())
}

async function promptAdminToken() {
  if (typeof window === 'undefined') return ''
  return await requestAdminToken({
    title: '写入权限',
    message: '当前操作需要写入权限。请输入令牌后将自动重试。'
  })
}

const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

client.interceptors.request.use((config) => {
  if (isWriteRequest(config)) {
    const token = getStoredAdminToken()
    if (token) config.headers['x-admin-token'] = token
  }
  return config
})

// 响应拦截：统一提取 data
client.interceptors.response.use(
  (res) => res.data,
  async (err) => {
    const original = err.config || {}
    const status = err.response?.status
    const code = err.response?.data?.error?.code

    if (isWriteRequest(original) && status === 401 && code === 'UNAUTHORIZED' && !original._adminTokenRetry) {
      const token = (await promptAdminToken()).trim()
      if (token) {
        setStoredAdminToken(token)
        original._adminTokenRetry = true
        original.headers = original.headers || {}
        original.headers['x-admin-token'] = token
        return client(original)
      }
    }

    if (isWriteRequest(original) && status === 403 && code === 'FORBIDDEN') {
      setStoredAdminToken('')
    }

    const message = err.response?.data?.error?.message || err.message || '请求失败'
    return Promise.reject(new Error(message))
  }
)

export default client

// 便捷方法
export const api = {
  get: (url, params) => client.get(url, { params }),
  post: (url, data) => client.post(url, data),
  put: (url, data) => client.put(url, data),
  delete: (url) => client.delete(url),
  setAdminToken: setStoredAdminToken,
  getAdminToken: getStoredAdminToken,
  clearAdminToken: () => setStoredAdminToken('')
}
