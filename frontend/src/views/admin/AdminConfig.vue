<template>
  <div>
    <!-- 配置说明 -->
    <div class="card">
      <div class="card-title">配置说明</div>
      <div class="desc-list">
        <div class="desc-item"><el-icon><CircleCheck /></el-icon><span>申请金额 ≥ 加签阈值时，审批流程自动追加企业负责人节点</span></div>
        <div class="desc-item"><el-icon><CircleCheck /></el-icon><span>票据数量与大小上限在提交申请、上传附件时校验</span></div>
        <div class="desc-item"><el-icon><CircleCheck /></el-icon><span>审批节点超时未处理将由系统自动提醒当前审批人</span></div>
        <div class="desc-item"><el-icon><CircleCheck /></el-icon><span>所有配置修改均写入审计日志，可在「审计日志」页查看</span></div>
      </div>
    </div>

    <!-- 配置表单 -->
    <div class="card">
      <div class="card-title">参数配置</div>
      <el-form :model="form" :label-position="isMobile ? 'top' : 'right'" label-width="190px" v-loading="loading">
        <el-row :gutter="16">
          <!-- 加签阈值：界面为元，保存时转分 -->
          <el-col :xs="24" :sm="12">
            <el-form-item label="企业负责人加签阈值（元）" prop="thresholdYuan">
              <el-input v-model="form.thresholdYuan" placeholder="如 100000" class="w-full">
                <template #prefix>¥</template>
              </el-input>
              <div class="hint">申请金额 ≥ 该阈值时自动加签企业负责人节点；保存时自动转换为分存储</div>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="单笔票据数量上限" prop="receiptMaxCount">
              <el-input-number v-model="form.receiptMaxCount" :min="1" :max="100" :step="1" :precision="0" step-strictly class="w-full" />
              <div class="hint">单笔报销申请可上传的票据数量上限（1 - 100）</div>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="票据总大小上限（MB）" prop="receiptMaxTotalMb">
              <el-input-number v-model="form.receiptMaxTotalMb" :min="1" :max="1000" :step="1" :precision="0" step-strictly class="w-full" />
              <div class="hint">单笔报销申请全部票据的总大小上限（1 - 1000 MB）</div>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="单文件大小上限（MB）" prop="receiptMaxSizeMb">
              <el-input-number v-model="form.receiptMaxSizeMb" :min="1" :max="50" :step="1" :precision="0" step-strictly class="w-full" />
              <div class="hint">单个票据文件的大小上限（1 - 50 MB）</div>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="催办超时（小时）" prop="remindTimeoutHours">
              <el-input-number v-model="form.remindTimeoutHours" :min="0" :max="8760" :step="0.1" :precision="2" class="w-full" />
              <div class="hint">审批节点超过该时长未处理将自动提醒审批人；演示环境建议设为 0.02（约 1 分钟）</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item>
          <div class="flex gap8 flex-wrap">
            <el-button type="primary" :loading="saving" @click="onSave">保存配置</el-button>
            <el-button :disabled="saving" @click="load">恢复已保存配置</el-button>
          </div>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
/**
 * 系统配置：读取配置列表（[{key,value,description}]）转 map 后渲染表单。
 * 金额口径：阈值后端为「分」（company_head_threshold_cents），界面展示「元」，
 * 提交前用 yuanToCents 转分并校验。其余配置为整数 / 可小数（催办超时小时）。
 */
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { adminGetConfig, adminUpdateConfig } from '@/api';
import { yuanToCents, centsToYuan } from '@/utils/format';
import { useMobile } from '@/utils/useMobile';

const isMobile = useMobile();

const loading = ref(false);
const saving = ref(false);
const configMap = ref({});

const form = reactive({
  thresholdYuan: '',      // 加签阈值（元，字符串输入）
  receiptMaxCount: 20,    // 单笔票据数量上限
  receiptMaxTotalMb: 100, // 票据总大小上限（MB）
  receiptMaxSizeMb: 10,   // 单文件大小上限（MB）
  remindTimeoutHours: 48, // 催办超时（小时，可小数）
});

// 从配置 map 中取数值（后端 value 为字符串，需转 Number；缺省用默认值兜底）
function numOf(key, fallback) {
  const v = Number(configMap.value[key]?.value);
  return Number.isFinite(v) ? v : fallback;
}

async function load() {
  loading.value = true;
  try {
    // 转成 { key: {key,value,description} } 的 map，便于按 key 取值
    const rows = await adminGetConfig();
    const map = {};
    rows.forEach((r) => { map[r.key] = r; });
    configMap.value = map;
    // 阈值：分 → 元（保留两位），表单输入为元字符串
    form.thresholdYuan = centsToYuan(numOf('company_head_threshold_cents', 10000000));
    form.receiptMaxCount = numOf('receipt_max_count', 20);
    form.receiptMaxTotalMb = numOf('receipt_max_total_mb', 100);
    form.receiptMaxSizeMb = numOf('receipt_max_size_mb', 10);
    form.remindTimeoutHours = numOf('remind_timeout_hours', 48);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function checkInt(v, name, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) {
    ElMessage.error(`${name}须为 ${min} - ${max} 之间的整数`);
    return false;
  }
  return true;
}

async function onSave() {
  // 阈值：元 → 分（非法格式返回 null）
  const cents = yuanToCents(form.thresholdYuan);
  if (cents === null) {
    ElMessage.error('加签阈值金额格式不正确（示例：100000 或 100000.50）');
    return;
  }
  if (!checkInt(form.receiptMaxCount, '票据数量上限', 1, 100)) return;
  if (!checkInt(form.receiptMaxTotalMb, '票据总大小上限', 1, 1000)) return;
  if (!checkInt(form.receiptMaxSizeMb, '单文件大小上限', 1, 50)) return;
  if (!Number.isFinite(form.remindTimeoutHours) || form.remindTimeoutHours < 0 || form.remindTimeoutHours > 8760) {
    ElMessage.error('催办超时须为 0 - 8760 之间的数值');
    return;
  }
  saving.value = true;
  try {
    await adminUpdateConfig({
      company_head_threshold_cents: cents,
      receipt_max_count: form.receiptMaxCount,
      receipt_max_total_mb: form.receiptMaxTotalMb,
      receipt_max_size_mb: form.receiptMaxSizeMb,
      remind_timeout_hours: form.remindTimeoutHours,
    });
    ElMessage.success('配置已保存（已写入审计日志）');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.desc-list { display: flex; flex-direction: column; gap: 10px; }
.desc-item { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.desc-item .el-icon { color: var(--el-color-primary); }
.hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; margin-top: 2px; }
</style>
