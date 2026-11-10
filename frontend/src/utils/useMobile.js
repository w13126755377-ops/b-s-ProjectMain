import { ref, onMounted, onBeforeUnmount } from 'vue';

/** 响应式断点：宽度 < 768px 视为移动端（配合 CSS 与布局切换） */
export function useMobile(breakpoint = 768) {
  const isMobile = ref(window.innerWidth < breakpoint);
  const onResize = () => { isMobile.value = window.innerWidth < breakpoint; };
  onMounted(() => window.addEventListener('resize', onResize));
  onBeforeUnmount(() => window.removeEventListener('resize', onResize));
  return isMobile;
}
