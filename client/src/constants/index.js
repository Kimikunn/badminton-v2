/**
 * 全局常量
 */
export const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
}

export const DEFAULT_BEST_OF = 3

export const BEST_OF_OPTIONS = [
  { value: 1, label: '一局定胜负' },
  { value: 3, label: '三局两胜' },
  { value: 7, label: '七局打满' }
]

export const TITLE_LEVELS = {
  S: { label: 'S级', color: 'gold', order: 0 },
  A: { label: 'A级', color: 'purple', order: 1 },
  B: { label: 'B级', color: 'blue', order: 2 },
  C: { label: 'C级', color: 'green', order: 3 },
  hidden: { label: '隐藏', color: 'gray', order: 4 }
}

export const GUEST_PLAYER_PREFIX = 'guest_'
export const GUEST_PLAYER_NAME = '外部球员'
