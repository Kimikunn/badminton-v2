<script setup>
/**
 * Input — 输入框组件
 *
 * @props {string} modelValue - v-model 绑定值
 * @props {string} type - text | textarea | select | date
 * @props {string} placeholder - 占位文本
 * @props {string} label - 标签文本
 * @props {string} error - 错误提示
 * @props {Array} options - select 类型的选项 [{ value, label }]
 * @props {number} rows - textarea 行数
 */
const model = defineModel({ type: [String, Number], default: '' })

defineProps({
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  label: { type: String, default: '' },
  error: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  rows: { type: Number, default: 3 }
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" class="text-xs font-semibold text-fg-secondary uppercase tracking-wider">{{ label }}</label>

    <textarea
      v-if="type === 'textarea'"
      v-model="model"
      class="w-full px-3 py-2.5 min-h-[80px] bg-canvas border border-line rounded-lg font-sans text-base text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast ease-out resize-y leading-normal appearance-none"
      :placeholder="placeholder"
      :rows="rows"
    ></textarea>

    <select
      v-else-if="type === 'select'"
      v-model="model"
      class="input-select w-full px-3 py-2.5 pr-8 bg-canvas border border-line rounded-lg font-sans text-base text-fg focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast ease-out appearance-none"
    >
      <option value="" disabled>{{ placeholder || '请选择' }}</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>

    <input
      v-else
      v-model="model"
      class="w-full px-3 py-2.5 bg-canvas border border-line rounded-lg font-sans text-base text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast ease-out appearance-none"
      :type="type"
      :placeholder="placeholder"
    />

    <span v-if="error" class="text-xs text-danger">{{ error }}</span>
  </div>
</template>

<style scoped>
.input-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}
</style>
