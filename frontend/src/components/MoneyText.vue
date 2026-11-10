<template>
  <span class="money" :class="{ strong: strong }">{{ prefix }}{{ centsToYuanText(cents) }}</span>
</template>

<script setup>
import { centsToYuanText } from '@/utils/format';

defineProps({
  /** 金额（分，整数） */
  cents: { type: [Number, String], default: 0 },
  prefix: { type: String, default: '¥' },
  strong: { type: Boolean, default: false },
});
</script>

<style scoped>
.money { font-variant-numeric: tabular-nums; }
.money.strong { font-weight: 700; color: var(--el-color-primary); }
</style>
