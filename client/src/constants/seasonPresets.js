/**
 * Season Presets
 *
 * 赛季业务规则固定在规则引擎中，这里只保存创建赛季时需要确认的元数据。
 */
export const SEASON_PRESETS = [
  {
    key: 's1-standard',
    code: 'S1',
    label: '赛季启航',
    ruleId: 'standard',
    totalRounds: 7,
    bestOf: 3,
    color: 'blue',
    description: '按常规大分、小分、得分排名。'
  },
  {
    key: 's2-comeback',
    code: 'S2',
    label: '绝地反击',
    ruleId: 's2',
    totalRounds: 7,
    bestOf: 3,
    color: 'red',
    description: '启用 S2 绝对压制与绝地反击规则。'
  },
  {
    key: 's3-energy',
    code: 'S3',
    label: '超能饮料',
    ruleId: 's3',
    totalRounds: 7,
    bestOf: 3,
    color: 'green',
    description: '启用 S3 饮料、压制 2.0 与关键先生规则。'
  },
  {
    key: 's4-stardust',
    code: 'S4',
    label: '星尘之征',
    ruleId: 's4',
    totalRounds: 7,
    bestOf: 3,
    color: 'yellow',
    description: '启用 S4 上篇骰子、下篇组合星尘规则。'
  },
  {
    key: 's5-mutation',
    code: 'S5',
    label: '异变秩序',
    ruleId: 's5',
    totalRounds: 9,
    bestOf: 3,
    color: 'red',
    description: '启用 S5 15/21 分制骰子与异变结算规则。'
  }
]

export const SEASON_COLOR_OPTIONS = [
  { value: 'blue', label: '蓝色' },
  { value: 'purple', label: '紫色' },
  { value: 'green', label: '绿色' },
  { value: 'yellow', label: '金色' },
  { value: 'red', label: '红色' },
  { value: 'orange', label: '橙色' }
]

export function buildPresetSeasonName(preset) {
  return `${preset.code}-${preset.label}`
}
