<template>
  <div v-loading="loading" class="app-detail">
    <!-- 无权限 / 不存在（服务端已鉴权，前端仅友好提示） -->
    <div v-if="error" class="card">
      <el-result
        :icon="errorCode === 403 ? 'warning' : 'error'"
        :title="errorCode === 403 ? '没有权限查看该申请' : errorCode === 404 ? '申请不存在' : '加载失败'"
        :sub-title="errorCode === 403 ? '仅申请人本人与审批链中的节点审批人可查看该申请' : errMsg"
      >
        <template #extra>
          <el-button type="primary" @click="goBack">返回</el-button>
        </template>
      </el-result>
    </div>

    <template v-else-if="app">
      <!-- 区块 1：标题卡（单号可复制 + 状态 + 元信息 + 操作按钮组） -->
      <div class="card">
        <div class="flex flex-wrap gap8 header-row">
          <el-button :icon="ArrowLeft" @click="goBack">返回</el-button>
          <span class="detail-title">{{ app.title }}</span>
          <StatusTag :status="app.status" />
          <div class="spacer" />
          <!-- 按钮组：按状态机 + 当前身份渲染（服务端为最终防线） -->
          <div class="flex gap8 flex-wrap">
            <template v-if="isApplicant && app.status === 'DRAFT'">
              <el-button :icon="Edit" @click="router.push(`/apps/${app.id}/edit`)">编辑</el-button>
              <el-button type="primary" :icon="Promotion" :loading="acting" @click="onSubmit">提交</el-button>
              <el-button type="danger" :icon="Delete" :loading="acting" @click="onDelete">删除</el-button>
            </template>
            <template v-else-if="isApplicant && app.status === 'IN_APPROVAL'">
              <el-button type="warning" :icon="RefreshLeft" :loading="acting" @click="onWithdraw">撤回</el-button>
              <el-button :icon="AlarmClock" :loading="acting" @click="onRemind">催办</el-button>
            </template>
            <template v-else-if="isApplicant && (app.status === 'REJECTED' || app.status === 'WITHDRAWN')">
              <el-button type="primary" :icon="CopyDocument" :loading="acting" @click="onCopy">复制重提</el-button>
            </template>
            <template v-if="isCurrentApprover">
              <el-button type="success" :icon="CircleCheck" @click="openApprove">批准</el-button>
              <el-button type="danger" :icon="CircleClose" @click="openReject">驳回</el-button>
            </template>
          </div>
        </div>

        <div class="meta flex flex-wrap mt16">
          <span class="meta-item">编号：<b>{{ app.app_no }}</b>
            <el-button link size="small" :icon="CopyDocument" @click="copyAppNo">复制</el-button>
          </span>
          <span class="meta-item">类型：{{ TYPE_LABEL[app.type] || app.type }}</span>
          <span class="meta-item">金额：<MoneyText :cents="app.total_amount_cents" strong /></span>
          <span class="meta-item">申请人：{{ app.applicant?.name || '—' }}（{{ deptName }}）</span>
          <span class="meta-item">提交时间：{{ formatDateTime(app.submitted_at) }}</span>
          <span v-if="app.sourceApplicationNo" class="meta-item">
            来源：复制自
            <el-link type="primary" :underline="false" @click="router.push(`/apps/${app.source_application_id}`)">
              {{ app.sourceApplicationNo }}
            </el-link>
          </span>
          <span v-if="app.template" class="meta-item">模板：{{ app.template.name }} v{{ app.template.version }}</span>
        </div>
      </div>

      <!-- 区块 2：审批进度（节点链 el-steps + 审批记录 el-timeline） -->
      <div class="card">
        <h3 class="card-title">审批进度</h3>
        <el-empty v-if="!app.instance" description="尚未提交，暂无审批进度" :image-size="60" />
        <template v-else>
          <el-steps
            :active="app.instance.current_node_idx"
            :direction="isMobile ? 'vertical' : 'horizontal'"
            align-center
          >
            <el-step v-for="n in steps" :key="n.idx" :title="n.name" :status="n.status">
              <template #description>
                <div>
                  {{ n.resolved_name || '—' }}
                  <!-- 受托代办：实际审批人为受托人，同时展示原审批人留痕 -->
                  <span v-if="n.delegated_from" class="text-muted">
                    （受托代办：原审批人 {{ n.delegated_from_name || '—' }}）
                  </span>
                </div>
                <div v-if="n.status === 'error'" class="text-danger">已驳回</div>
                <div
                  v-else-if="app.instance.status === 'WITHDRAWN' && n.idx === app.instance.current_node_idx"
                  class="text-muted"
                >已撤回</div>
              </template>
            </el-step>
          </el-steps>

          <h4 class="sub-title">审批记录</h4>
          <el-timeline v-if="app.records.length">
            <el-timeline-item
              v-for="(r, i) in app.records"
              :key="i"
              :type="timelineType(r.action)"
              :timestamp="formatDateTime(r.created_at)"
              placement="top"
            >
              <div class="timeline-node-name">{{ recordTitle(r) }}</div>
              <div class="text-muted">操作人：{{ r.acted_by_name || '—' }}</div>
              <!-- 驳回意见红色突出显示 -->
              <div
                v-if="r.comment"
                class="timeline-comment"
                :class="{ 'text-danger': r.action === 'REJECT' }"
              >{{ r.comment }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无审批记录" :image-size="40" />
        </template>
      </div>

      <!-- 区块 3：业务详情（按类型渲染） -->
      <div class="card">
        <h3 class="card-title">业务详情</h3>

        <!-- 采购：基础信息 + 明细表 + 报价表 + 单一来源/选择理由 -->
        <template v-if="app.type === 'PROCUREMENT'">
          <el-descriptions :column="isMobile ? 1 : 2" border size="small">
            <el-descriptions-item label="采购原因" :span="isMobile ? 1 : 2">{{ form.reason }}</el-descriptions-item>
            <el-descriptions-item label="所属项目">{{ form.project || '—' }}</el-descriptions-item>
            <el-descriptions-item label="期望到货日期">{{ formatDate(form.expectedArrivalDate) }}</el-descriptions-item>
            <el-descriptions-item label="预算上限"><MoneyText :cents="form.budgetCapCents" /></el-descriptions-item>
            <el-descriptions-item label="备注" :span="isMobile ? 1 : 2">{{ form.remark || '—' }}</el-descriptions-item>
          </el-descriptions>

          <h4 class="sub-title">采购明细</h4>
          <el-table :data="app.items" border size="small" show-summary :summary-method="itemsSummary">
            <el-table-column prop="name" label="物品/服务名称" min-width="140" />
            <el-table-column prop="spec" label="规格" min-width="100">
              <template #default="{ row }">{{ row.spec || '—' }}</template>
            </el-table-column>
            <el-table-column prop="quantity" label="数量" width="80" align="right" />
            <el-table-column prop="unit" label="单位" width="70" />
            <el-table-column label="单价" width="120" align="right">
              <template #default="{ row }"><MoneyText :cents="row.unit_price_cents" /></template>
            </el-table-column>
            <el-table-column label="金额" width="130" align="right">
              <template #default="{ row }"><MoneyText :cents="row.amount_cents" strong /></template>
            </el-table-column>
          </el-table>

          <h4 class="sub-title">报价比较</h4>
          <el-table :data="app.quotations" border size="small" :row-class-name="quoteRowClass">
            <el-table-column prop="supplier_name" label="供应商" min-width="130" />
            <el-table-column label="报价日期" width="110">
              <template #default="{ row }">{{ formatDate(row.quote_date) }}</template>
            </el-table-column>
            <el-table-column label="报价金额" width="130" align="right">
              <template #default="{ row }"><MoneyText :cents="row.quote_amount_cents" /></template>
            </el-table-column>
            <el-table-column label="报价明细" min-width="150">
              <template #default="{ row }">{{ row.quote_detail || '—' }}</template>
            </el-table-column>
            <el-table-column label="购买链接" width="110">
              <template #default="{ row }">
                <el-link v-if="row.purchase_link" :href="row.purchase_link" target="_blank" rel="noopener">查看链接</el-link>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="线上/拟选" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.online" size="small" type="primary" class="mr4">线上</el-tag>
                <el-tag v-if="row.selected" size="small" type="success">拟选</el-tag>
                <span v-if="!row.online && !row.selected">—</span>
              </template>
            </el-table-column>
            <el-table-column label="报价附件" min-width="150">
              <template #default="{ row }">
                <div class="flex gap8 flex-wrap">
                  <template v-for="id in row.attachmentIds || []" :key="id">
                    <el-image
                      v-if="attMap[id] && isImage(attMap[id])"
                      :src="attachmentContentUrl(id)"
                      :preview-src-list="[attachmentContentUrl(id)]"
                      class="att-thumb"
                      fit="cover"
                    />
                    <el-link v-else-if="attMap[id]" :href="attachmentContentUrl(id)" target="_blank" rel="noopener">
                      <el-icon><Document /></el-icon>{{ attMap[id].original_name }}
                    </el-link>
                  </template>
                  <span v-if="!(row.attachmentIds || []).length" class="text-muted">无</span>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <!-- 单一来源采购在审批界面明确标注；选择理由同样展示 -->
          <div v-if="form.singleSourceReason" class="warn-block">单一来源采购说明：{{ form.singleSourceReason }}</div>
          <div v-if="form.selectReason" class="select-reason">选择理由：{{ form.selectReason }}</div>
        </template>

        <!-- 差旅：描述列表 + 附件 -->
        <template v-else-if="app.type === 'TRAVEL'">
          <el-descriptions :column="isMobile ? 1 : 2" border size="small">
            <el-descriptions-item label="目的地">{{ form.destination }}</el-descriptions-item>
            <el-descriptions-item label="出发地点">{{ form.departure }}</el-descriptions-item>
            <el-descriptions-item label="开始时间">{{ formatDateTime(form.startTime) }}</el-descriptions-item>
            <el-descriptions-item label="结束时间">{{ formatDateTime(form.endTime) }}</el-descriptions-item>
            <el-descriptions-item label="出差天数（系统计算）">
              <span class="amount-strong">{{ form.days ?? '—' }}</span> 天
              <div class="text-muted">口径：按实际时长折算，不足一天按一天计</div>
            </el-descriptions-item>
            <el-descriptions-item label="交通方式">{{ form.transport }}</el-descriptions-item>
            <el-descriptions-item label="出差目的" :span="isMobile ? 1 : 2">{{ form.purpose }}</el-descriptions-item>
            <el-descriptions-item label="同行人员">{{ (form.companions || []).join('、') || '—' }}</el-descriptions-item>
            <el-descriptions-item label="费用预算"><MoneyText :cents="form.budgetCents" strong /></el-descriptions-item>
            <el-descriptions-item label="备注" :span="isMobile ? 1 : 2">{{ form.remark || '—' }}</el-descriptions-item>
            <el-descriptions-item label="附件" :span="isMobile ? 1 : 2">
              <div class="flex gap8 flex-wrap">
                <template v-for="id in form.attachmentIds || []" :key="id">
                  <el-image
                    v-if="attMap[id] && isImage(attMap[id])"
                    :src="attachmentContentUrl(id)"
                    :preview-src-list="[attachmentContentUrl(id)]"
                    class="att-thumb"
                    fit="cover"
                  />
                  <el-link v-else-if="attMap[id]" :href="attachmentContentUrl(id)" target="_blank" rel="noopener">
                    <el-icon><Document /></el-icon>{{ attMap[id].original_name }}
                  </el-link>
                </template>
                <span v-if="!(form.attachmentIds || []).length" class="text-muted">无</span>
              </div>
            </el-descriptions-item>
          </el-descriptions>
        </template>

        <!-- 报销：说明 + 重复票据预警 + 明细表（无票高亮）+ 服务端重算合计 + 关联申请 -->
        <template v-else-if="app.type === 'REIMBURSEMENT'">
          <el-descriptions :column="isMobile ? 1 : 2" border size="small">
            <el-descriptions-item label="报销说明" :span="isMobile ? 1 : 2">{{ form.description }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="isMobile ? 1 : 2">{{ form.remark || '—' }}</el-descriptions-item>
          </el-descriptions>

          <!-- 跨申请重复票据预警：财务审核重点，服务端实时重算 -->
          <div v-if="app.duplicateWarnings?.length" class="warn-block">
            <div class="warn-title">重复票据预警（财务审核重点）</div>
            <div v-for="(w, i) in app.duplicateWarnings" :key="i">{{ dupText(w) }}</div>
          </div>

          <el-table :data="app.expenseItems" border size="small" :row-class-name="expenseRowClass">
            <el-table-column label="费用类型" width="90">
              <template #default="{ row }">{{ EXPENSE_TYPE_LABEL[row.expense_type] || row.expense_type }}</template>
            </el-table-column>
            <el-table-column label="发生日期" width="110">
              <template #default="{ row }">{{ formatDate(row.occur_date) }}</template>
            </el-table-column>
            <el-table-column prop="purpose" label="用途说明" min-width="140" />
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }"><MoneyText :cents="row.amount_cents" /></template>
            </el-table-column>
            <el-table-column label="票据号" width="120">
              <template #default="{ row }">
                <!-- 无票支出：红色标签 + 原因 warn-block 突出显示（财务审核界面要求） -->
                <el-tag v-if="row.no_receipt" size="small" type="danger">无票</el-tag>
                <span v-else>{{ row.receipt_no || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="票据" min-width="170">
              <template #default="{ row }">
                <div v-if="row.no_receipt" class="warn-block no-receipt-block">无票支出原因：{{ row.no_receipt_reason || '—' }}</div>
                <div v-else class="flex gap8 flex-wrap">
                  <template v-for="r in row.receipts || []" :key="r.attachment_id">
                    <el-image
                      v-if="attMap[r.attachment_id] && isImage(attMap[r.attachment_id])"
                      :src="attachmentContentUrl(r.attachment_id)"
                      :preview-src-list="[attachmentContentUrl(r.attachment_id)]"
                      class="att-thumb"
                      fit="cover"
                    />
                    <el-link
                      v-else-if="attMap[r.attachment_id]"
                      :href="attachmentContentUrl(r.attachment_id)"
                      target="_blank"
                      rel="noopener"
                    >
                      <el-icon><Document /></el-icon>{{ attMap[r.attachment_id].original_name }}
                    </el-link>
                  </template>
                  <span v-if="!(row.receipts || []).length" class="text-muted">无</span>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <!-- 合计由服务端重算（明细金额之和），客户端仅展示 -->
          <div class="flex-between flex-wrap mt8">
            <span class="text-muted">费用合计（由服务端重算，明细金额之和）：</span>
            <MoneyText :cents="expenseTotal" strong />
          </div>

          <!-- 关联申请：本人已批准的差旅/采购 -->
          <div v-if="app.linkedApplication" class="linked-box">
            <div class="flex gap8 flex-wrap">
              <span>关联差旅/采购申请：</span>
              <el-link type="primary" @click="router.push(`/apps/${app.linkedApplication.id}`)">
                {{ app.linkedApplication.app_no }} {{ app.linkedApplication.title }}
              </el-link>
            </div>
            <div class="text-muted mt8">
              <template v-if="app.linkedApplication.form_data?.destination">
                目的地：{{ app.linkedApplication.form_data.destination }} ·
              </template>
              <template v-if="app.linkedApplication.form_data?.days != null">
                天数：{{ app.linkedApplication.form_data.days }} 天 ·
              </template>
              金额：<MoneyText :cents="app.linkedApplication.total_amount_cents" />
            </div>
          </div>
        </template>

        <!-- 自定义：按模板 form_schema 动态只读渲染 -->
        <template v-else-if="app.type === 'CUSTOM'">
          <el-descriptions v-if="customFields.length" :column="isMobile ? 1 : 2" border size="small">
            <el-descriptions-item
              v-for="f in customFields"
              :key="f.id"
              :label="f.label"
              :span="(f.type === 'textarea' || f.type === 'attachment') && !isMobile ? 2 : 1"
            >
              <template v-if="f.type === 'amount'">
                <!-- amount 字段：分 → 元展示 -->
                <MoneyText :cents="form[f.id]" />
              </template>
              <template v-else-if="f.type === 'attachment'">
                <!-- attachment 字段：id 数组 → 文件名列表 -->
                <div class="flex gap8 flex-wrap">
                  <template v-for="id in form[f.id] || []" :key="id">
                    <el-image
                      v-if="attMap[id] && isImage(attMap[id])"
                      :src="attachmentContentUrl(id)"
                      :preview-src-list="[attachmentContentUrl(id)]"
                      class="att-thumb"
                      fit="cover"
                    />
                    <el-link v-else-if="attMap[id]" :href="attachmentContentUrl(id)" target="_blank" rel="noopener">
                      <el-icon><Document /></el-icon>{{ attMap[id].original_name }}
                    </el-link>
                  </template>
                  <span v-if="!(form[f.id] || []).length" class="text-muted">无</span>
                </div>
              </template>
              <template v-else-if="f.type === 'textarea'">
                <div class="pre-wrap">{{ form[f.id] || '—' }}</div>
              </template>
              <template v-else>
                <!-- radio 显示选项值；date/number/text 原样 -->
                {{ form[f.id] ?? '—' }}
              </template>
            </el-descriptions-item>
          </el-descriptions>
          <el-empty v-else description="该模板暂无表单字段" :image-size="60" />
        </template>
      </div>

      <!-- 区块 4：附件（按业务类型分组，图片缩略图预览 / PDF 新窗口打开 / 下载） -->
      <div class="card">
        <h3 class="card-title">附件</h3>
        <el-empty v-if="!attachmentGroups.length" description="暂无附件" :image-size="60" />
        <template v-for="g in attachmentGroups" :key="g.bizType">
          <div class="att-group-title">{{ BIZ_TYPE_LABEL[g.bizType] || g.bizType }}（{{ g.list.length }}）</div>
          <div class="att-grid">
            <div v-for="att in g.list" :key="att.id" class="att-card">
              <el-image
                v-if="isImage(att)"
                :src="attachmentContentUrl(att.id)"
                :preview-src-list="[attachmentContentUrl(att.id)]"
                class="att-thumb-lg"
                fit="cover"
              />
              <div v-else class="pdf-box"><el-icon :size="30" color="#f56c6c"><Document /></el-icon></div>
              <div class="att-name" :title="att.original_name">{{ att.original_name }}</div>
              <div class="text-muted">{{ formatBytes(att.size_bytes) }} · {{ formatDateTime(att.uploaded_at) }}</div>
              <div class="att-actions">
                <el-link v-if="!isImage(att)" type="primary" :href="attachmentContentUrl(att.id)" target="_blank" rel="noopener">
                  打开
                </el-link>
                <a class="att-download" :href="attachmentDownloadUrl(att.id)">下载</a>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- 批准对话框：意见选填 -->
    <el-dialog v-model="approveVisible" title="批准申请" width="480px" :close-on-click-modal="false">
      <p class="dialog-tip">确认通过「{{ currentNodeName }}」节点的审批？通过后流程将进入下一节点。</p>
      <el-input
        v-model="approveForm.comment"
        type="textarea"
        :rows="3"
        maxlength="500"
        show-word-limit
        placeholder="审批意见（选填）"
      />
      <template #footer>
        <el-button @click="approveVisible = false">取消</el-button>
        <el-button type="success" :loading="approveLoading" @click="doApprove">确认批准</el-button>
      </template>
    </el-dialog>

    <!-- 驳回对话框：理由必填 -->
    <el-dialog v-model="rejectVisible" title="驳回申请" width="480px" :close-on-click-modal="false">
      <el-form ref="rejectFormRef" :model="rejectForm" :rules="rejectRules" label-position="top">
        <el-form-item label="驳回理由（必填，将通知申请人）" prop="reason">
          <el-input
            v-model="rejectForm.reason"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="请填写驳回理由"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="rejectLoading" @click="doReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft, CopyDocument, Edit, Delete, Promotion, AlarmClock, RefreshLeft, CircleCheck, CircleClose,
} from '@element-plus/icons-vue';
import {
  getApplication, submitApplication, withdrawApplication, remindApplication,
  copyApplication, deleteApplication, approveTask, rejectTask,
  attachmentContentUrl, attachmentDownloadUrl,
} from '@/api';
import {
  TYPE_LABEL, EXPENSE_TYPE_LABEL, BIZ_TYPE_LABEL, ACTION_LABEL,
  formatDateTime, formatDate, formatBytes, centsToYuanText,
} from '@/utils/format';
import { useAuthStore } from '@/stores/auth';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';
import MoneyText from '@/components/MoneyText.vue';
import StatusTag from '@/components/StatusTag.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const notify = useNotifyStore();
const isMobile = useMobile();

/* ---------- 状态 ---------- */
const app = ref(null);
const loading = ref(false);
const error = ref(false);
const errorCode = ref(0);
const errMsg = ref('');
const acting = ref(false); // 头部操作按钮 loading，防重复点击

const appId = computed(() => Number(route.params.id));
const form = computed(() => app.value?.form_data || {});

/* ---------- 数据加载：SSE refreshTick 变化时自动刷新（作业要求） ---------- */
async function load() {
  loading.value = true;
  try {
    app.value = await getApplication(appId.value);
    error.value = false;
  } catch (e) {
    app.value = null;
    error.value = true;
    errorCode.value = e.code || 0;
    errMsg.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(() => notify.refreshTick, load);
watch(() => route.params.id, load); // 详情页之间跳转时组件复用，需重新加载
onMounted(load);

/* ---------- 身份与按钮组判断（服务端兜底，前端仅为体验） ---------- */
const isApplicant = computed(() => app.value && auth.user && app.value.applicant_id === auth.user.id);
const isCurrentApprover = computed(
  () => app.value?.instance
    && app.value.instance.status === 'IN_APPROVAL'
    && app.value.instance.current_approver_id === auth.user?.id
);
const deptName = computed(() => app.value?.applicant?.dept_name || app.value?.dept_name || '—');
const currentNodeName = computed(() => {
  const inst = app.value?.instance;
  if (!inst) return '';
  const n = (inst.nodes || []).find((x) => x.idx === inst.current_node_idx);
  return n?.name || '';
});

/* ---------- 区块 2：节点链步骤状态（完成/当前/未到/驳回/撤回） ---------- */
const steps = computed(() => {
  const inst = app.value?.instance;
  if (!inst) return [];
  return (inst.nodes || []).map((n) => {
    let status = 'wait';
    if (inst.status === 'APPROVED') {
      status = 'success'; // 终态通过：全部完成
    } else if (inst.status === 'REJECTED') {
      if (n.idx < inst.current_node_idx) status = 'success';
      else if (n.idx === inst.current_node_idx) status = 'error'; // 驳回节点标红
    } else if (inst.status === 'WITHDRAWN') {
      if (n.idx < inst.current_node_idx) status = 'success';
      else if (n.idx === inst.current_node_idx) status = 'wait'; // 撤回：当前节点灰色
    } else if (inst.status === 'IN_APPROVAL') {
      if (n.idx < inst.current_node_idx) status = 'success';
      else if (n.idx === inst.current_node_idx) status = 'process';
    }
    return { ...n, status };
  });
});

const TIMELINE_TYPE = { SUBMIT: 'primary', APPROVE: 'success', REJECT: 'danger', WITHDRAW: 'info' };
function timelineType(action) {
  return TIMELINE_TYPE[action] || 'info';
}
/** 记录标题：提交记录不带节点名（避免"提交申请 · 提交申请"重复） */
function recordTitle(r) {
  const label = ACTION_LABEL[r.action] || r.action;
  return r.action === 'SUBMIT' ? label : `${label} · ${r.node_name || ''}`;
}

/* ---------- 附件工具 ---------- */
const attMap = computed(() => {
  const m = {};
  (app.value?.attachments || []).forEach((a) => { m[a.id] = a; });
  return m;
});
const isImage = (att) => !!att && !!att.mime && att.mime.startsWith('image/');

// 按业务类型分组（票据/报价/差旅/自定义）
const attachmentGroups = computed(() => {
  const m = new Map();
  (app.value?.attachments || []).forEach((a) => {
    if (!m.has(a.biz_type)) m.set(a.biz_type, []);
    m.get(a.biz_type).push(a);
  });
  return [...m.entries()].map(([bizType, list]) => ({ bizType, list }));
});

/* ---------- 区块 3 辅助 ---------- */
// 采购明细合计（表格底部汇总行）
function itemsSummary({ columns, data }) {
  const total = data.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
  return columns.map((col, i) => {
    if (i === 0) return '合计';
    if (col.property === 'amount_cents') return `¥ ${centsToYuanText(total)}`;
    return '';
  });
}
function quoteRowClass({ row }) {
  return row.selected ? 'row-selected' : ''; // 拟选供应商整行高亮
}
function expenseRowClass({ row }) {
  return row.no_receipt ? 'row-no-receipt' : ''; // 无票支出整行红色高亮
}
// 服务端重算合计：明细金额之和（客户端值忽略）
const expenseTotal = computed(
  () => (app.value?.expenseItems || []).reduce((s, it) => s + Number(it.amount_cents || 0), 0)
);
// 重复票据预警文案：票据号 / 文件 → 其他报销单（申请人）
function dupText(w) {
  const parts = [];
  if (w.receiptNo) parts.push(`票据号 ${w.receiptNo}`);
  if (w.fileName) parts.push(`文件 ${w.fileName}`);
  return `${parts.join(' / ') || '存在相同票据'} 已在其他报销单 ${w.appNo}（${w.applicantName}）中出现`;
}

/* ---------- 自定义模板动态只读渲染 ---------- */
/** 显示条件求值（与后端一致：被隐藏字段跳过） */
function matchCondition(cond, fd) {
  if (!cond || cond.field === undefined) return true;
  const v = fd[cond.field];
  const cv = cond.value;
  switch (cond.op) {
    case 'eq': return String(v) === String(cv);
    case 'neq': return String(v) !== String(cv);
    case 'gt': return Number(v) > Number(cv);
    case 'lt': return Number(v) < Number(cv);
    case 'in': return Array.isArray(cv) ? cv.some((x) => String(x) === String(v)) : false;
    default: return true;
  }
}
const customFields = computed(() => {
  const tpl = app.value?.template;
  if (!tpl) return [];
  let schema = tpl.form_schema;
  if (typeof schema === 'string') {
    try { schema = JSON.parse(schema); } catch { schema = null; }
  }
  const fd = form.value || {};
  return (schema?.fields || []).filter((f) => matchCondition(f.condition, fd));
});

/* ---------- 通用操作 ---------- */
function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/apps');
}

async function copyAppNo() {
  const no = app.value?.app_no;
  if (!no) return;
  try {
    await navigator.clipboard.writeText(no);
    ElMessage.success('编号已复制');
  } catch {
    // 非 https 环境降级：临时 textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = no;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    ElMessage.success('编号已复制');
  }
}

/** 跨单重复票据预警弹窗（提交响应 warnings，警告不阻断） */
function showWarnings(warnings) {
  const lines = (warnings || []).map((w) => dupText(w));
  ElMessageBox.alert(lines.join('<br/>'), '重复票据预警', {
    type: 'warning',
    dangerouslyUseHTMLString: true,
    confirmButtonText: '知道了',
  }).catch(() => {});
}

/* ---------- 申请人操作 ---------- */
async function onSubmit() {
  try {
    await ElMessageBox.confirm(`确认提交「${app.value.title}」？提交后将进入审批流程，不可再编辑。`, '提交确认', {
      type: 'warning',
      confirmButtonText: '确认提交',
      cancelButtonText: '取消',
    });
  } catch { return; }
  acting.value = true;
  try {
    const res = await submitApplication(app.value.id);
    if (res && res.warnings && res.warnings.length) showWarnings(res.warnings);
    ElMessage.success('提交成功，已进入审批流程');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
    if (e.code === 409) await load(); // 并发冲突：提示后刷新
  } finally {
    acting.value = false;
  }
}

async function onWithdraw() {
  try {
    await ElMessageBox.confirm(`确认撤回「${app.value.title}」？撤回后审批流程终止，当前审批人无法继续处理。`, '撤回确认', {
      type: 'warning',
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消',
    });
  } catch { return; }
  acting.value = true;
  try {
    await withdrawApplication(app.value.id);
    ElMessage.success('已撤回');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
    if (e.code === 409) await load(); // 撤回与审批并发冲突：提示后刷新
  } finally {
    acting.value = false;
  }
}

async function onRemind() {
  try {
    await ElMessageBox.confirm('将向当前审批人发送催办提醒（每个节点仅可催办一次）。确认催办？', '催办确认', {
      type: 'warning',
      confirmButtonText: '确认催办',
      cancelButtonText: '取消',
    });
  } catch { return; }
  acting.value = true;
  try {
    await remindApplication(app.value.id);
    ElMessage.success('催办提醒已发送');
  } catch (e) {
    // 每节点限催办 1 次：409 专用提示
    if (e.code === 409) ElMessage.warning('该节点已催办过，请耐心等待审批人处理');
    else ElMessage.error(e.message);
  } finally {
    acting.value = false;
  }
}

async function onCopy() {
  try {
    await ElMessageBox.confirm('将基于该申请生成新的草稿（新编号），可修改后重新提交。确认复制？', '复制重提', {
      type: 'info',
      confirmButtonText: '确认复制',
      cancelButtonText: '取消',
    });
  } catch { return; }
  acting.value = true;
  try {
    const res = await copyApplication(app.value.id);
    ElMessage.success('已复制为新草稿，请修改后重新提交');
    router.push(`/apps/${res.id}/edit`);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    acting.value = false;
  }
}

async function onDelete() {
  try {
    await ElMessageBox.confirm(`确认删除草稿「${app.value.title}」？删除后不可恢复。`, '删除确认', {
      type: 'error',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    });
  } catch { return; }
  acting.value = true;
  try {
    await deleteApplication(app.value.id);
    ElMessage.success('草稿已删除');
    router.push('/apps');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    acting.value = false;
  }
}

/* ---------- 审批人操作（批准 / 驳回对话框） ---------- */
const approveVisible = ref(false);
const approveLoading = ref(false);
const approveForm = reactive({ comment: '' });

const rejectVisible = ref(false);
const rejectLoading = ref(false);
const rejectFormRef = ref();
const rejectForm = reactive({ reason: '' });
const rejectRules = { reason: [{ required: true, message: '驳回理由不能为空', trigger: 'blur' }] };

function openApprove() {
  approveForm.comment = '';
  approveVisible.value = true;
}
function openReject() {
  rejectForm.reason = '';
  rejectVisible.value = true;
}

async function doApprove() {
  const inst = app.value?.instance;
  if (!inst) return;
  approveLoading.value = true;
  try {
    await approveTask(inst.id, approveForm.comment.trim());
    ElMessage.success('已批准');
    approveVisible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
    if (e.code === 409) { approveVisible.value = false; await load(); } // 已被他人处理：刷新
  } finally {
    approveLoading.value = false;
  }
}

async function doReject() {
  const inst = app.value?.instance;
  if (!inst) return;
  try {
    await rejectFormRef.value.validate();
  } catch { return; }
  rejectLoading.value = true;
  try {
    await rejectTask(inst.id, rejectForm.reason.trim());
    ElMessage.success('已驳回');
    rejectVisible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
    if (e.code === 409) { rejectVisible.value = false; await load(); }
  } finally {
    rejectLoading.value = false;
  }
}
</script>

<style scoped>
.header-row { align-items: center; }
.detail-title { font-size: 18px; font-weight: 600; word-break: break-all; }
.spacer { flex: 1; }

/* 元信息行：可换行，移动端友好 */
.meta { font-size: 13px; color: var(--el-text-color-secondary); gap: 4px 20px; }
.meta-item { display: inline-flex; align-items: center; gap: 4px; }

.sub-title { font-size: 14px; font-weight: 600; margin: 16px 0 8px; }

/* 附件分组网格（自适应列宽，移动端单列） */
.att-group-title { font-weight: 600; font-size: 14px; margin: 14px 0 8px; }
.att-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.att-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px; padding: 8px; background: var(--el-fill-color-lighter);
}
.att-thumb { width: 48px; height: 48px; border-radius: 4px; flex-shrink: 0; }
.att-thumb-lg { width: 100%; height: 110px; border-radius: 4px; }
.pdf-box {
  width: 100%; height: 110px; border-radius: 4px; background: var(--el-fill-color-light);
  display: flex; align-items: center; justify-content: center;
}
.att-name { font-size: 12px; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-actions { display: flex; gap: 12px; margin-top: 6px; font-size: 13px; }
.att-download { color: var(--el-color-primary); text-decoration: none; }

/* 拟选供应商行高亮 / 无票支出行红色高亮 */
:deep(.row-selected) td { background: var(--el-color-success-light-9) !important; }
:deep(.row-no-receipt) td { background: var(--el-color-danger-light-9) !important; }

.no-receipt-block { margin: 0; font-size: 12px; }
.warn-title { font-weight: 600; margin-bottom: 4px; }
.select-reason { margin-top: 8px; font-size: 13px; color: var(--el-text-color-regular); }
.linked-box { border: 1px dashed var(--el-border-color); border-radius: 6px; padding: 8px 12px; margin-top: 8px; }
.pre-wrap { white-space: pre-wrap; word-break: break-all; }
.dialog-tip { margin: 0 0 12px; color: var(--el-text-color-regular); }
.mr4 { margin-right: 4px; }

/* 移动端：附件单列、网格收紧 */
@media (max-width: 768px) {
  .att-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .detail-title { font-size: 16px; }
}
</style>
