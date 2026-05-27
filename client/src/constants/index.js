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

// Each title has a unique lucide icon name
export const TITLE_ICONS = {
  't_s1_champion': 'Trophy',
  't_s2_champion': 'Medal',
  't_s3_champion': 'Award',
  't_s4_winner': 'Crown',
  't_glass_cannon': 'Bomb',
  't_weapon_collector': 'Swords',
  't_nest_master': 'Fish',
  't_first_try': 'Sword',
  't_equipment_expert': 'Wrench',
  't_edge_winner': 'Target',
  't_snow_melting': 'Snowflake',
  't_spring_messenger': 'Sparkles',
  't_thousand_goals': 'Goal',
  't_yonex_fan': 'Shirt',
  't_victor_fan': 'Footprints',
  't_lining_fan': 'Zap',
  't_zero_purchase': 'ShoppingCart',
  't_devil_king': 'Skull',
  't_not_lee': 'SmilePlus',
  't_third_person': 'Eye',
  't_silent': 'VolumeX'
}

