import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // 本地开发：/api 代理到后端（docker 部署时由 nginx 反代）
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    // Element Plus / ECharts 全量引入的 vendor 包较大（gzip 后 ~350KB），按阈值放行
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 拆分 vendor 大包，避免单 chunk 过大
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-element': ['element-plus', '@element-plus/icons-vue'],
          'vendor-echarts': ['echarts'],
        },
      },
    },
  },
});
