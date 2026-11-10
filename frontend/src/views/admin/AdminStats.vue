<template>
  <div v-loading="loading">
    <!-- 统计口径说明（作业要求界面标注） -->
    <div class="card scope-note">
      <div class="flex gap8">
        <el-icon class="scope-icon"><InfoFilled /></el-icon>
        <span>
          统计口径：按<strong>提交时间</strong>统计；金额仅计入<strong>已通过</strong>（APPROVED）申请；草稿 / 驳回 / 撤回不计入金额。
        </span>
      </div>
    </div>

    <!-- 卡片 1：各类型 × 状态统计表（byType 聚合） -->
    <div class="card">
      <h3 class="card-title">各类型 × 状态统计</h3>
      <el-table
        :data="typeRows"
        border
        stripe
        :row-class-name="rowClassName"
      >
        <el-table-column prop="typeName" label="类型" min-width="130" />
        <el-table-column
          v-for="s in STATUS_KEYS"
          :key="s"
          :label="STATUS_LABEL[s]"
          align="center"
          min-width="90"
        >
          <template #default="{ row }">
            <span :class="cellClass(s, row[s])">{{ row[s] }}</span>
          </template>
        </el-table-column>
        <el-table-column label="合计" align="center" width="90">
          <template #default="{ row }">
            <span :class="cellClass('__total', row.total)">{{ row.total }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 卡片 2：按部门已通过金额柱状图 -->
    <div class="card">
      <h3 class="card-title">各部门已通过金额</h3>
      <div class="chart-box">
        <div ref="deptEl" class="chart"></div>
        <el-empty
          v-if="loaded && !deptList.length"
          :description="error ? '加载失败，请稍后重试' : '暂无数据'"
          :image-size="60"
          class="chart-empty"
        />
      </div>
    </div>

    <!-- 卡片 3：近 6 个月已通过金额趋势折线 -->
    <div class="card">
      <h3 class="card-title">近 6 个月已通过金额趋势</h3>
      <div class="chart-box">
        <div ref="trendEl" class="chart"></div>
        <el-empty
          v-if="loaded && !trendList.length"
          :description="error ? '加载失败，请稍后重试' : '暂无数据'"
          :image-size="60"
          class="chart-empty"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { adminStats } from '@/api';
import { TYPE_LABEL, STATUS_LABEL, centsToYuanText } from '@/utils/format';
import { useNotifyStore } from '@/stores/notify';

const notify = useNotifyStore();

const loading = ref(false);
const loaded = ref(false);
const error = ref(false);
const stats = ref({ byType: [], amountByDept: [], trend: [] });

const STATUS_KEYS = ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

/* ---------- 卡片 1：byType 扁平数组 → 类型行 × 状态列矩阵（末尾补合计行） ---------- */
const typeRows = computed(() => {
  const map = {};
  (stats.value.byType || []).forEach(({ type, status, c }) => {
    if (!map[type]) map[type] = {};
    map[type][status] = c || 0;
  });
  // 按 TYPE_LABEL 固定顺序展示已知类型，未知类型（如有）追加在后
  const keys = [...new Set([...Object.keys(TYPE_LABEL), ...Object.keys(map)])];
  const rows = keys.map((t) => {
    const row = { type: t, typeName: TYPE_LABEL[t] || t };
    STATUS_KEYS.forEach((s) => { row[s] = map[t]?.[s] || 0; });
    row.total = STATUS_KEYS.reduce((sum, s) => sum + row[s], 0);
    return row;
  });
  const totalRow = { type: '__total', typeName: '合计' };
  STATUS_KEYS.forEach((s) => { totalRow[s] = rows.reduce((sum, r) => sum + r[s], 0); });
  totalRow.total = STATUS_KEYS.reduce((sum, s) => sum + totalRow[s], 0);
  rows.push(totalRow);
  return rows;
});

function rowClassName({ row }) {
  return row.type === '__total' ? 'total-row' : '';
}

function cellClass(col, v) {
  if (!v) return 'text-muted';
  // 已通过列与合计列突出显示
  if (col === 'APPROVED' || col === '__total') return 'cell-strong';
  return '';
}

/* ---------- ECharts 配置 ---------- */

const deptEl = ref();
const trendEl = ref();
let deptChart = null;
let trendChart = null;

const deptList = computed(() => stats.value.amountByDept || []);
const trendList = computed(() => stats.value.trend || []);

/** 坐标轴金额刻度：分 → 元（按设计文档 13.2：图表金额坐标轴同样分→元格式化） */
const axisFormatter = (v) => '¥' + (v / 100).toLocaleString('zh-CN');

function buildDeptOption(list) {
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const d = p.data || {};
        return `<b>${p.name}</b><br/>已通过金额：¥${centsToYuanText(d.value)}<br/>已通过单数：${d.count ?? 0} 单`;
      },
    },
    grid: { left: 16, right: 24, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: list.map((i) => i.dept_name),
      axisLabel: { interval: 0, rotate: list.length > 5 ? 30 : 0 },
    },
    yAxis: { type: 'value', axisLabel: { formatter: axisFormatter } },
    series: [
      {
        name: '已通过金额',
        type: 'bar',
        barMaxWidth: 40,
        itemStyle: { color: '#409EFF', borderRadius: [4, 4, 0, 0] },
        data: list.map((i) => ({ value: i.approved_cents || 0, count: i.approved_count || 0 })),
      },
    ],
  };
}

function buildTrendOption(list) {
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const d = p.data || {};
        return `<b>${p.name}</b><br/>已通过金额：¥${centsToYuanText(d.value)}<br/>申请单数：${d.count ?? 0} 单`;
      },
    },
    grid: { left: 16, right: 24, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: list.map((i) => i.ym) },
    yAxis: { type: 'value', axisLabel: { formatter: axisFormatter } },
    series: [
      {
        name: '已通过金额',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 3, color: '#409EFF' },
        itemStyle: { color: '#409EFF' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64,158,255,0.28)' },
            { offset: 1, color: 'rgba(64,158,255,0.02)' },
          ]),
        },
        data: list.map((i) => ({ value: i.approved_cents || 0, count: i.c || 0 })),
      },
    ],
  };
}

function renderCharts() {
  deptChart?.setOption(buildDeptOption(deptList.value));
  trendChart?.setOption(buildTrendOption(trendList.value));
  // 数据切换或容器尺寸变化后重算尺寸（避免初始 0 宽）
  requestAnimationFrame(() => {
    deptChart?.resize();
    trendChart?.resize();
  });
}

/* ---------- 数据加载（SSE refreshTick 变化时自动重载） ---------- */

async function load() {
  loading.value = true;
  try {
    stats.value = await adminStats();
    error.value = false;
  } catch (e) {
    error.value = true;
    ElMessage.error(e.message || '加载统计失败');
  } finally {
    loading.value = false;
    loaded.value = true;
    await nextTick();
    renderCharts();
  }
}

function onResize() {
  deptChart?.resize();
  trendChart?.resize();
}

onMounted(() => {
  deptChart = echarts.init(deptEl.value);
  trendChart = echarts.init(trendEl.value);
  window.addEventListener('resize', onResize);
  load();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  deptChart?.dispose();
  trendChart?.dispose();
  deptChart = null;
  trendChart = null;
});

// 实时自动刷新：SSE 收到业务变化（refresh 事件）时重载统计
watch(() => notify.refreshTick, load);
</script>

<style scoped>
.scope-note {
  padding: 10px 16px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.scope-icon {
  color: var(--el-color-primary);
  flex-shrink: 0;
  margin-top: 2px;
}

/* 合计行突出 */
:deep(.total-row) td {
  font-weight: 700;
  background: var(--el-fill-color-light);
}
.cell-strong {
  font-weight: 600;
  color: var(--el-color-success);
}

/* 图表容器：保持固定高度，空数据时用遮罩展示空状态 */
.chart-box {
  position: relative;
  height: 320px;
}
.chart {
  width: 100%;
  height: 100%;
}
.chart-empty {
  position: absolute;
  inset: 0;
  margin: 0;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 移动端：降低图表高度，卡片内边距已由全局样式收紧 */
@media (max-width: 768px) {
  .chart-box {
    height: 260px;
  }
}
</style>
