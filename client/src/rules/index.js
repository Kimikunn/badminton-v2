/**
 * 规则注册中心
 * 管理所有赛季规则模块
 */

import standardRule from './standard'
import s2Rule from './s2'
import s3Rule from './s3'
import s4Rule from './s4'
import s5Rule from './s5'

// 规则注册表
const rules = {
  standard: standardRule,
  s2: s2Rule,
  s3: s3Rule,
  s4: s4Rule,
  s5: s5Rule
}

/**
 * 获取规则模块
 * @param {string} ruleId - 规则ID
 * @returns {Object} 规则模块
 */
export function getRule(ruleId) {
  return rules[ruleId] || rules.standard
}

/**
 * 获取所有可用规则列表
 * @returns {Array} 规则列表
 */
export function getAllRules() {
  return Object.values(rules).map(rule => ({
    id: rule.id,
    name: rule.name,
    description: rule.description
  }))
}

/**
 * 检查规则是否存在
 * @param {string} ruleId - 规则ID
 * @returns {boolean}
 */
export function hasRule(ruleId) {
  return ruleId in rules
}

export default {
  getRule,
  getAllRules,
  hasRule,
  rules
}
