<template>
  <router-view />
</template>

<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useNotifyStore } from '@/stores/notify';

const auth = useAuthStore();
const notify = useNotifyStore();

// 登录后启动实时通知连接（SSE + 轮询兜底），退出时断开
watch(
  () => auth.token,
  (t) => (t ? notify.init() : notify.stop()),
  { immediate: false }
);
onMounted(() => {
  if (auth.token) notify.init();
});
onBeforeUnmount(() => notify.stop());
</script>
