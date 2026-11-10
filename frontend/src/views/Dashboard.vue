<template>
  <div>
    <!-- 欢迎卡片：问候语 + 姓名/部门/日期 + 部门未确认警告 -->
    <div class="card">
      <div class="flex-between">
        <div>
          <div class="welcome-greeting">{{ greet.text }}，{{ auth.user?.name || '' }}</div>
          <div class="text-muted mt8">{{ auth.user?.dept_name || '—' }} · {{ todayText }}</div>
        </div>
        <el-icon class="welcome-icon"><component :is="greet.icon" /></el-icon>
      </div>
      <el-alert
        v-if="auth.user && !auth.deptConfirmed"
        class="mt16"
        type="warning"
        show-icon
        :closable="false"
        title="部门归属尚未经管理员确认，提交申请前请联系管理员"
      />
    </div>

    <!-- 快捷入口：4 个可点击卡片，移动端 2×2 -->
    <div class="card grid-card">
      <h3 class="card-title"><el-icon><Pointer /></el-icon>快捷入口</h3>
      <el-row :gutter="16">
        <el-col v-for="q in quickEntries" :key="q.path" :xs="12" :md="6" class="grid-col">
          <el-card shadow="hover" class="quick-card" @click="router.push(q.path)">
            <el-badge :value="q.badge" :hidden="!q.badge" :max="99">
              <el-icon :size="28" class="quick-icon"><component :is="q.icon" /></el-icon>
            </el-badge>
            <div class="quick-label">{{ q.label }}</div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 我的数据：个人统计数字卡 -->
    <div class="card grid-card" v-loading="loading">
      <h3 class="card-title"><el-icon><DataLine /></el-icon>我的数据</h3>
      <el-row :gutter="16">
        <el-col v-for="s in statCards" :key="s.label" :xs="12" :md="6" class="grid-col">
          <div class="stat-tile" :class="'stat-' + s.color">
            <div class="stat-value">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 近 6 个月提交趋势（x=ym, y=c） -->
    <div class="card" v-loading="loading">
      <h3 class="card-title"><el-icon><TrendCharts /></el-icon>近 6 个月提交趋势</h3>
      <el-empty v-if="!loading && !hasSubmitData" description="暂无提交记录" :image-size="90" />
      <div v-if="hasSubmitData" ref="submitRef" class="chart"></div>
    </div>

    <!-- 部门/企业统计：仅 DEPT_HEAD / FINANCE / COMPANY_HEAD / ADMIN 可见 -->
    <div v-if="canSeeDept" class="card" v-loading="deptLoading">
      <h3 class="card-title"><el-icon><DataAnalysis /></el-icon>部门/企业统计</h3>

      <!-- 403：无统计授权提示 -->
      <el-alert
        v-if="deptDenied"
        type="warning"
        show-icon
        :closable="false"
        title="暂无统计权限"
        description="需管理员在管理后台→统计授权中授予统计权限"
      />

      <template v-else-if="dept">
        <!-- 按类型 × 状态统计表 -->
        <div class="sub-title">按类型 × 状态统计</div>
        <el-table :data="typeStatusRows" size="small" border class="mb16">
          <el-table-column prop="type" label="类型" min-width="130">
            <template #default="{ row }">{{ TYPE_LABEL[row.type] || row.type }}</template>
          </el-table-column>
          <el-table-column v-for="s in statusCols" :key="s" :prop="s" :label="STATUS_LABEL[s]" align="center" width="76" />
          <el-table-column prop="total" label="合计" align="center" width="76" />
        </el-table>

        <!-- 按部门已通过金额柱状图 + 近 6 月已通过金额趋势折线 -->
        <el-row :gutter="16">
          <el-col :xs="24" :lg="12">
            <div class="chart-block">
              <div class="sub-title">各部门已通过金额（单位：元）</div>
              <el-empty v-if="!hasDeptAmount" description="暂无数据" :image-size="80" />
              <div v-else ref="deptBarRef" class="chart"></div>
            </div>
          </el-col>
          <el-col :xs="24" :lg="12">
            <div class="chart-block">
              <div class="sub-title">近 6 个月已通过金额趋势（单位：元）</div>
              <el-empty v-if="!hasDeptTrend" description="暂无数据" :image-size="80" />
              <div v-else ref="deptTrendRef" class="chart"></div>
            </div>
          </el-col>
        </el-row>

        <!-- 统计口径说明 -->
        <div class="text-muted caliber">统计口径：按提交时间；已通过金额仅含"已通过"申请；草稿/驳回/撤回不计入。</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import dayjs from 'dayjs';
import { ElMessage } from 'element-plus';
import { personalStats, deptStats } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useNotifyStore } from '@/stores/notify';
import { centsToYuanText, STATUS_LABEL, TYPE_LABEL } from '@/utils/format';

const router = useRouter();
const auth = useAuthStore();
const notify = useNotifyStore();

/* ---------- 欢迎卡片 ---------- */
// 按当前小时返回问候语与对应图标
const greet = computed(() => {
  const h = dayjs().hour();
  if (h >= 5 && h < 12) return { text: '早上好', icon: 'Sunrise' };
  if (h >= 12 && h < 18) return { text: '下午好', icon: 'Sunny' };
  return { text: '晚上好', icon: 'Moon' };
});
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const todayText = `${dayjs().format('YYYY年M月D日')} ${WEEK[dayjs().day()]}`;

/* ---------- 快捷入口（审批任务/通知中心带角标） ---------- */
const quickEntries = computed(() => [
  { label: '发起申请', path: '/apps/new', icon: 'CirclePlus', badge: 0 },
  { label: '我的申请', path: '/apps', icon: 'Tickets', badge: 0 },
  { label: '审批任务', path: '/tasks', icon: 'Checked', badge: personal.value?.todoCount || 0 },
  { label: '通知中心', path: '/notifications', icon: 'Bell', badge: notify.unread },
]);

/* ---------- 个人统计 ---------- */
const personal = ref(null);
const loading = ref(false);

// 我的数据数字卡（颜色与状态语义一致）
const statCards = computed(() => {
  const byStatus = personal.value?.byStatus || {};
  return [
    { label: '总申请数', value: personal.value?.total ?? 0, color: 'primary' },
    { label: '待办', value: personal.value?.todoCount ?? 0, color: 'primary' },
    { label: '已办', value: personal.value?.doneCount ?? 0, color: 'primary' },
    { label: '审批中', value: byStatus.IN_APPROVAL ?? 0, color: 'warning' },
    { label: '已通过', value: byStatus.APPROVED ?? 0, color: 'success' },
    { label: '草稿', value: byStatus.DRAFT ?? 0, color: 'info' },
    { label: '已驳回', value: byStatus.REJECTED ?? 0, color: 'danger' },
    { label: '已撤回', value: byStatus.WITHDRAWN ?? 0, color: 'info' },
  ];
});

// 近 6 个月有提交数据才渲染图表，否则显示空态
const hasSubmitData = computed(() =>
  (personal.value?.monthlySubmitted || []).some((d) => (d.c || 0) > 0)
);

/* ---------- 部门/企业统计 ---------- */
const STAT_ROLES = ['DEPT_HEAD', 'FINANCE', 'COMPANY_HEAD', 'ADMIN'];
const canSeeDept = computed(() => STAT_ROLES.some((r) => auth.roleCodes.includes(r)));

const dept = ref(null);
const deptLoading = ref(false);
const deptDenied = ref(false); // 403：无统计授权

const statusCols = ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

// byType:[{type,status,c}] 透视成 类型 × 状态 行
const typeStatusRows = computed(() => {
  const map = {};
  (dept.value?.byType || []).forEach((it) => {
    if (!map[it.type]) {
      map[it.type] = { type: it.type, total: 0 };
      statusCols.forEach((s) => { map[it.type][s] = 0; });
    }
    map[it.type][it.status] = it.c;
    map[it.type].total += it.c;
  });
  return Object.values(map);
});

const hasDeptAmount = computed(() => (dept.value?.amountByDept || []).length > 0);
const hasDeptTrend = computed(() => (dept.value?.trend || []).length > 0);

/* ---------- 数据加载 ---------- */
async function loadPersonal() {
  try {
    personal.value = await personalStats();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function loadDept() {
  deptLoading.value = true;
  try {
    dept.value = await deptStats();
    deptDenied.value = false;
  } catch (e) {
    dept.value = null;
    // 403 = 未授予统计权限 → 展示提示卡（其余错误提示消息）
    deptDenied.value = e.code === 403;
    if (!deptDenied.value) ElMessage.error(e.message);
  } finally {
    deptLoading.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([loadPersonal(), canSeeDept.value ? loadDept() : Promise.resolve()]);
  } finally {
    loading.value = false;
  }
  // 数据更新后 v-if 分支可能变化，等 DOM 更新再同步图表
  nextTick(syncCharts);
}

/* ---------- ECharts（onMounted init / 卸载 dispose / resize 自适应） ---------- */
const submitRef = ref();
const deptBarRef = ref();
const deptTrendRef = ref();
let submitChart = null;
let deptBarChart = null;
let deptTrendChart = null;

/** 分 → 坐标轴短格式（如 12.5万） */
function yuanAxisShort(cents) {
  const yuan = Number(cents || 0) / 100;
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(1)}万`;
  return String(yuan);
}

// 近 6 个月提交趋势折线（x=ym, y=c）
function submitOption() {
  const data = personal.value?.monthlySubmitted || [];
  return {
    grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.map((d) => d.ym),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#dcdfe6' } },
      axisLabel: { color: '#909399' },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#ebeef5' } },
      axisLabel: { color: '#909399' },
    },
    series: [
      {
        name: '提交数',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: data.map((d) => d.c),
        lineStyle: { width: 2, color: '#409eff' },
        itemStyle: { color: '#409eff' },
        areaStyle: { color: 'rgba(64,158,255,0.08)' },
      },
    ],
  };
}

// 各部门已通过金额柱状图（tooltip 分 → 元）
function deptBarOption() {
  const rows = dept.value?.amountByDept || [];
  return {
    grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0];
        const row = rows[p.dataIndex] || {};
        const count = row.approved_count != null ? `<br/>通过单数：${row.approved_count}` : '';
        return `${p.name}<br/>已通过金额：¥${centsToYuanText(row.approved_cents)}${count}`;
      },
    },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.dept_name),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#dcdfe6' } },
      axisLabel: { color: '#909399', interval: 0 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#ebeef5' } },
      axisLabel: { color: '#909399', formatter: yuanAxisShort },
    },
    series: [
      {
        name: '已通过金额',
        type: 'bar',
        data: rows.map((r) => r.approved_cents),
        barMaxWidth: 40,
        itemStyle: { color: '#67c23a', borderRadius: [4, 4, 0, 0] },
      },
    ],
  };
}

// 近 6 个月已通过金额趋势折线（y=approved_cents，tooltip 分 → 元）
function deptTrendOption() {
  const data = dept.value?.trend || [];
  return {
    grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (params) => {
        const p = params[0];
        const d = data[p.dataIndex] || {};
        const count = d.c != null ? `<br/>通过单数：${d.c}` : '';
        return `${p.axisValue}<br/>已通过金额：¥${centsToYuanText(d.approved_cents)}${count}`;
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.map((d) => d.ym),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#dcdfe6' } },
      axisLabel: { color: '#909399' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#ebeef5' } },
      axisLabel: { color: '#909399', formatter: yuanAxisShort },
    },
    series: [
      {
        name: '已通过金额',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: data.map((d) => d.approved_cents),
        lineStyle: { width: 2, color: '#67c23a' },
        itemStyle: { color: '#67c23a' },
      },
    ],
  };
}

// 按当前数据状态创建/更新/销毁三个图表
function syncCharts() {
  if (submitRef.value) {
    if (!submitChart) submitChart = echarts.init(submitRef.value);
    submitChart.setOption(submitOption(), true);
  } else if (submitChart) {
    submitChart.dispose();
    submitChart = null;
  }

  if (deptBarRef.value) {
    if (!deptBarChart) deptBarChart = echarts.init(deptBarRef.value);
    deptBarChart.setOption(deptBarOption(), true);
  } else if (deptBarChart) {
    deptBarChart.dispose();
    deptBarChart = null;
  }

  if (deptTrendRef.value) {
    if (!deptTrendChart) deptTrendChart = echarts.init(deptTrendRef.value);
    deptTrendChart.setOption(deptTrendOption(), true);
  } else if (deptTrendChart) {
    deptTrendChart.dispose();
    deptTrendChart = null;
  }
}

function resizeCharts() {
  submitChart?.resize();
  deptBarChart?.resize();
  deptTrendChart?.resize();
}

function disposeCharts() {
  submitChart?.dispose();
  deptBarChart?.dispose();
  deptTrendChart?.dispose();
  submitChart = deptBarChart = deptTrendChart = null;
}

/* ---------- 生命周期与实时刷新 ---------- */
onMounted(async () => {
  window.addEventListener('resize', resizeCharts);
  await loadAll();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts);
  disposeCharts();
});

// SSE/轮询检测到业务变化（refreshTick 自增）→ 重新加载统计与图表
watch(() => notify.refreshTick, loadAll);
</script>

<style scoped>
/* 欢迎卡片 */
.welcome-greeting { font-size: 20px; font-weight: 600; }
.welcome-icon { font-size: 40px; color: var(--el-color-primary-light-5); }

/* 栅格卡片：列自带下边距，抵消 .card 内边距 */
.grid-card { padding-bottom: 0; }
.grid-col { margin-bottom: 16px; }

/* 快捷入口 */
.quick-card { cursor: pointer; }
.quick-card :deep(.el-card__body) {
  padding: 22px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.quick-icon { color: var(--el-color-primary); }
.quick-label { font-size: 14px; }

/* 统计数字卡 */
.stat-tile {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 14px 12px;
  text-align: center;
}
.stat-value { font-size: 26px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.stat-label { margin-top: 4px; font-size: 13px; color: var(--el-text-color-secondary); }
.stat-primary .stat-value { color: var(--el-color-primary); }
.stat-success .stat-value { color: var(--el-color-success); }
.stat-warning .stat-value { color: var(--el-color-warning); }
.stat-danger .stat-value { color: var(--el-color-danger); }
.stat-info .stat-value { color: var(--el-color-info); }

/* 图表 */
.chart { width: 100%; height: 280px; }
.chart-block { margin-bottom: 16px; }
.sub-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.caliber { font-size: 12px; }

@media (max-width: 768px) {
  .chart { height: 240px; }
}
</style>
