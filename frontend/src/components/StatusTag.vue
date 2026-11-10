<template>
  <el-tag :type="STATUS_TAG_TYPE[status] || 'info'" size="small" disable-transitions>
    {{ STATUS_LABEL[status] || status }}
  </el-tag>
</template>

<script setup>
import { STATUS_LABEL, STATUS_TAG_TYPE } from '@/utils/format';

defineProps({
  status: { type: String, required: true },
});
</script>
