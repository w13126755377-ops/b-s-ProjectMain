<template>
  <div>
    <!-- 顶部说明卡：模板发布机制 -->
    <div class="card">
      <div class="card-title"><el-icon><InfoFilled /></el-icon>模板发布机制说明</div>
      <div class="mech-item">
        <span class="mech-dot">1</span>
        <span>发布即校验并启用：点击「发布」会先校验模板配置（字段、条件引用、审批节点、审批人规则），校验通过后该版本变为「已发布」并立即启用，同编码（code）的旧版本自动停用。</span>
      </div>
      <div class="mech-item">
        <span class="mech-dot">2</span>
        <span>申请按快照流转：员工提交申请时，按提交时已发布的模板版本生成审批链快照；之后的模板修改、停用均不影响已提交的申请。</span>
      </div>
      <div class="mech-item">
        <span class="mech-dot">3</span>
        <span>编辑已发布模板生成新版本草稿：编辑「已发布 / 已停用」模板并保存时，系统自动生成新版本草稿（版本号 +1），需重新发布后才对新的申请生效。</span>
      </div>
      <div class="mech-item">
        <span class="mech-dot">4</span>
        <span>内置模板只读：内置流程（采购 / 差旅 / 报销）仅可查看配置概要，不可编辑、发布或停用；自定义模板支持完整设计。</span>
      </div>
    </div>

    <!-- 模板列表 -->
    <div class="card">
      <div class="flex-between list-head">
        <div class="card-title" style="margin: 0">流程模板列表</div>
        <div class="flex gap8">
          <el-button :icon="Refresh" @click="load">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">新建模板</el-button>
        </div>
      </div>

      <el-table :data="templates" v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="code" label="编码" min-width="130" />
        <el-table-column label="类别" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.category === 'BUILTIN' ? 'warning' : 'success'">
              {{ row.category === 'BUILTIN' ? '内置' : '自定义' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="版本" width="70">
          <template #default="{ row }">v{{ row.version }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="statusMeta(row.status).type">{{ statusMeta(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="适用部门" min-width="150">
          <template #default="{ row }">
            <span v-if="row.applicableDepts && row.applicableDepts.length" class="text-muted">
              {{ deptNames(row.applicableDepts) }}
            </span>
            <el-tag v-else size="small" type="info">全部部门</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="240">
          <template #default="{ row }">
            <!-- 内置模板：只读查看 -->
            <el-button
              v-if="row.category === 'BUILTIN'"
              link type="primary" size="small" :icon="View"
              @click="openView(row)"
            >查看</el-button>
            <template v-else>
              <el-button link type="primary" size="small" :icon="Edit" @click="openEdit(row)">编辑</el-button>
              <el-button
                v-if="row.status === 'DRAFT'"
                link type="success" size="small" :icon="Promotion"
                @click="publishRow(row)"
              >发布</el-button>
              <el-button v-else-if="row.status === 'PUBLISHED'" link type="warning" size="small" @click="toggleRow(row)">停用</el-button>
              <el-button v-else-if="row.status === 'DISABLED'" link type="success" size="small" @click="toggleRow(row)">启用</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无流程模板" :image-size="80" /></template>
      </el-table>
    </div>

    <!-- 新建模板对话框 -->
    <el-dialog v-model="createVisible" title="新建流程模板" width="480px">
      <el-form label-width="72px" @submit.prevent>
        <el-form-item label="名称" required>
          <el-input v-model="createForm.name" maxlength="100" placeholder="如：请假申请、用章申请" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="createForm.description" type="textarea" :rows="3" maxlength="300"
            placeholder="简要说明该流程的用途（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="confirmCreate">创建并编辑</el-button>
      </template>
    </el-dialog>

    <!-- 内置模板查看弹窗（只读：formSchema / flowConfig 概要） -->
    <el-dialog v-model="viewVisible" title="模板详情（内置 · 只读）" width="680px">
      <template v-if="viewRow">
        <el-descriptions :column="isMobile ? 1 : 2" border size="small">
          <el-descriptions-item label="名称">{{ viewRow.name }}</el-descriptions-item>
          <el-descriptions-item label="编码">{{ viewRow.code }}</el-descriptions-item>
          <el-descriptions-item label="类别">
            <el-tag size="small" :type="viewRow.category === 'BUILTIN' ? 'warning' : 'success'">
              {{ viewRow.category === 'BUILTIN' ? '内置' : '自定义' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="版本">v{{ viewRow.version }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="statusMeta(viewRow.status).type">{{ statusMeta(viewRow.status).label }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="适用部门">{{ viewDeptText }}</el-descriptions-item>
          <el-descriptions-item label="描述" :span="isMobile ? 1 : 2">{{ viewRow.description || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="section-title">表单字段概要（{{ viewFields.length }}）</div>
        <el-table :data="viewFields" size="small" border>
          <el-table-column prop="label" label="名称" min-width="100" />
          <el-table-column prop="id" label="标识" min-width="100" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ FIELD_TYPE_LABEL[row.type] || row.type }}</template>
          </el-table-column>
          <el-table-column label="必填" width="60">
            <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="显示条件" min-width="180">
            <template #default="{ row }"><span class="text-muted">{{ condText(row) }}</span></template>
          </el-table-column>
        </el-table>

        <div class="section-title">审批节点概要（{{ viewNodes.length }}）</div>
        <div class="node-list">
          <div v-for="(n, ni) in viewNodes" :key="ni" class="node-line">
            <span class="node-idx">{{ ni + 1 }}</span>
            <span class="node-name">{{ n.name }}</span>
            <el-tag size="small" type="info">{{ RULE_TYPE_LABEL[n.rule && n.rule.type] || (n.rule && n.rule.type) }}</el-tag>
            <span v-if="n.rule && n.rule.type === 'SPECIFIED_USER'" class="text-muted">{{ userName(n.rule.user_id) }}</span>
            <span v-if="ni < viewNodes.length - 1" class="node-arrow">→</span>
          </div>
          <el-empty v-if="!viewNodes.length" description="暂无审批节点" :image-size="60" />
        </div>
      </template>
      <template #footer>
        <el-button type="primary" @click="viewVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 发布失败错误弹窗（列表行发布失败时，el-alert 保留换行展示多行错误） -->
    <el-dialog v-model="publishErrorVisible" title="发布失败" width="560px">
      <el-alert type="error" :closable="false">
        <template #title>发布校验未通过，请修正以下问题</template>
        <div class="pre-line">{{ publishError }}</div>
      </el-alert>
      <template #footer>
        <el-button type="primary" @click="publishErrorVisible = false">知道了</el-button>
      </template>
    </el-dialog>

    <!-- 编辑抽屉 -->
    <el-drawer v-model="drawerVisible" :size="isMobile ? '100%' : '780px'">
      <template #header>
        <div class="flex-between w-full">
          <span class="drawer-head">
            编辑流程模板
            <span v-if="form.name" class="text-muted">（{{ form.name }}）</span>
            <el-tag v-if="editingStatus" size="small" :type="statusMeta(editingStatus).type" class="head-tag">
              {{ statusMeta(editingStatus).label }}
            </el-tag>
          </span>
          <el-button link :icon="Close" @click="drawerVisible = false" />
        </div>
      </template>

      <el-form label-position="top">
        <!-- 已发布/已停用模板编辑提示 -->
        <el-alert v-if="editingStatus !== 'DRAFT'" type="warning" :closable="false" class="mb16">
          该模板当前为「已发布 / 已停用」：保存后将生成新版本草稿（版本号 +1），需重新发布才生效；原版本及已提交的申请不受影响。
        </el-alert>

        <!-- 1) 基本信息 -->
        <div class="section-title">基本信息</div>
        <el-row :gutter="12">
          <el-col :xs="24" :md="12">
            <el-form-item label="模板名称" required>
              <el-input v-model="form.name" maxlength="100" placeholder="模板名称" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-form-item label="适用部门（不选 = 全部部门）">
              <el-select
                v-model="form.applicableDepts" multiple clearable filterable
                collapse-tags collapse-tags-tooltip placeholder="不选 = 全部部门" style="width: 100%"
              >
                <el-option v-for="d in deptOptions" :key="d.id" :label="d.name" :value="d.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="描述">
              <el-input v-model="form.description" type="textarea" :rows="2" maxlength="300" placeholder="简要说明该流程的用途" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 2) 表单字段设计器 -->
        <div class="section-title">
          <span>表单字段设计（{{ editingFields.length }} 个字段）</span>
          <el-button type="primary" size="small" :icon="Plus" @click="addField">添加字段</el-button>
        </div>
        <el-empty v-if="!editingFields.length" description="还没有表单字段，点击右上角「添加字段」" :image-size="60" />
        <div v-for="(f, idx) in editingFields" :key="idx" class="designer-card">
          <div class="card-head">
            <span class="card-head-title">字段 {{ idx + 1 }}</span>
            <span class="flex gap8">
              <el-button link size="small" :icon="Top" :disabled="idx === 0" @click="moveUp(editingFields, idx)">上移</el-button>
              <el-button link size="small" :icon="Bottom" :disabled="idx === editingFields.length - 1" @click="moveDown(editingFields, idx)">下移</el-button>
              <el-button link size="small" type="danger" :icon="Delete" @click="removeAt(editingFields, idx)">删除</el-button>
            </span>
          </div>
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12" :md="6">
              <el-form-item label="名称">
                <el-input v-model="f.label" maxlength="50" placeholder="如：请假事由" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <el-form-item label="标识（id）">
                <el-input v-model="f.id" maxlength="32" placeholder="如：reason" />
                <div v-if="fieldIdInvalid(f)" class="text-danger">需以小写字母开头，仅含小写字母/数字/下划线，≤32 字符</div>
                <div v-else class="text-muted">以小写字母开头，仅含小写字母/数字/下划线</div>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="8">
              <el-form-item label="类型">
                <el-select v-model="f.type" style="width: 100%">
                  <el-option v-for="t in FIELD_TYPES" :key="t.value" :label="t.label" :value="t.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="4">
              <el-form-item label="必填">
                <el-switch v-model="f.required" />
              </el-form-item>
            </el-col>
          </el-row>
          <!-- radio：选项自由输入（≥2） -->
          <el-row v-if="f.type === 'radio'" :gutter="12">
            <el-col :span="24">
              <el-form-item label="选项（至少 2 个，输入后回车添加）">
                <el-select
                  v-model="f.options" multiple filterable allow-create default-first-option
                  :reserve-keyword="false" placeholder="输入选项后回车添加" style="width: 100%"
                >
                  <el-option v-for="(o, oi) in f.options" :key="oi" :label="o" :value="o" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <!-- number/amount：范围校验（amount 单位为分，界面以元输入） -->
          <el-row v-if="f.type === 'number' || f.type === 'amount'" :gutter="12">
            <el-col :xs="24" :sm="12">
              <el-form-item :label="f.type === 'amount' ? '最小值（元）' : '最小值'">
                <el-input v-model="f.min" :placeholder="f.type === 'amount' ? '如：100.00' : '如：0.5'">
                  <template v-if="f.type === 'amount'" #prefix>¥</template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item :label="f.type === 'amount' ? '最大值（元）' : '最大值'">
                <el-input v-model="f.max" :placeholder="f.type === 'amount' ? '如：10000.00' : '如：30'">
                  <template v-if="f.type === 'amount'" #prefix>¥</template>
                </el-input>
              </el-form-item>
            </el-col>
          </el-row>
          <!-- 条件显示 -->
          <el-row :gutter="12">
            <el-col :xs="24" :sm="8" :md="5">
              <el-form-item label="显示条件 · 目标字段（选填）">
                <el-select v-model="f.conditionField" clearable filterable placeholder="选择目标字段" style="width: 100%">
                  <el-option v-for="o in condFieldOptions(idx)" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="8" :md="4">
              <el-form-item label="运算符">
                <el-select v-model="f.conditionOp" style="width: 100%">
                  <el-option v-for="o in OP_TYPES" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="8" :md="10">
              <el-form-item :label="f.conditionOp === 'in' ? '值（多个用逗号分隔）' : '值'">
                <el-input v-model="f.conditionValue" :placeholder="f.conditionOp === 'in' ? '如：病假,事假' : '如：病假'" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="5">
              <div v-if="f.conditionField" class="cond-hint text-muted">
                当「{{ refFieldLabel(f.conditionField) }}」{{ OP_LABEL[f.conditionOp] }}「{{ String(f.conditionValue || '…') }}」时显示
              </div>
            </el-col>
          </el-row>
        </div>

        <!-- 3) 审批节点设计器 -->
        <div class="section-title">
          <span>审批节点设计（{{ editingNodes.length }} 个节点）</span>
          <el-button type="primary" size="small" :icon="Plus" @click="addNode">添加节点</el-button>
        </div>
        <div v-if="editingNodes.length < 2" class="warn-block">
          审批节点至少需要 2 个（当前 {{ editingNodes.length }} 个）；节点按从上到下的顺序依次审批。
        </div>
        <div v-for="(n, idx) in editingNodes" :key="idx" class="designer-card">
          <div class="card-head">
            <span class="card-head-title">第 {{ idx + 1 }} 步</span>
            <span class="flex gap8">
              <el-button link size="small" :icon="Top" :disabled="idx === 0" @click="moveUp(editingNodes, idx)">上移</el-button>
              <el-button link size="small" :icon="Bottom" :disabled="idx === editingNodes.length - 1" @click="moveDown(editingNodes, idx)">下移</el-button>
              <el-button link size="small" type="danger" :icon="Delete" @click="removeAt(editingNodes, idx)">删除</el-button>
            </span>
          </div>
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12" :md="7">
              <el-form-item label="节点名称">
                <el-input v-model="n.name" maxlength="50" placeholder="如：部门负责人审批" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="7">
              <el-form-item label="审批人规则">
                <el-select
                  v-model="n.ruleType" style="width: 100%"
                  @change="n.userId = n.ruleType === 'SPECIFIED_USER' ? n.userId : null"
                >
                  <el-option v-for="r in RULE_TYPES" :key="r.value" :label="r.label" :value="r.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col v-if="n.ruleType === 'SPECIFIED_USER'" :xs="24" :sm="12" :md="10">
              <el-form-item label="指定用户">
                <el-select
                  v-model="n.userId" filterable remote clearable
                  :remote-method="searchUserRemote" :loading="userSearching"
                  placeholder="输入姓名 / 账号搜索" style="width: 100%"
                >
                  <el-option v-for="u in userOptions" :key="u.id" :label="`${u.name}（${u.username}）`" :value="u.id" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </el-form>

      <template #footer>
        <!-- 发布失败：后端 400 返回多行错误列表，保留换行展示 -->
        <div v-if="publishError" class="mb16">
          <el-alert type="error" :closable="true" @close="publishError = ''">
            <template #title>发布校验未通过，请修正以下问题</template>
            <div class="pre-line">{{ publishError }}</div>
          </el-alert>
        </div>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">关闭</el-button>
          <el-button type="primary" :loading="saving" @click="saveTemplate">保存</el-button>
          <el-button v-if="editingStatus === 'DRAFT'" type="success" :loading="publishing" @click="publishFromDrawer">发布</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Plus, Top, Bottom, Delete, Refresh, View, Edit, Promotion, Close,
} from '@element-plus/icons-vue';
import {
  adminListTemplates, adminCreateTemplate, adminUpdateTemplate,
  adminPublishTemplate, adminToggleTemplate, adminListDepartments,
  adminListUsers, searchUsers,
} from '@/api';
import { useNotifyStore } from '@/stores/notify';
import { useMobile } from '@/utils/useMobile';
import { yuanToCents, centsToYuan } from '@/utils/format';

const notify = useNotifyStore();
const isMobile = useMobile();

/* ---------- 常量 ---------- */
const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const FIELD_TYPES = [
  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'amount', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'radio', label: '单选' },
  { value: 'attachment', label: '附件' },
];
const FIELD_TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]));
const RULE_TYPES = [
  { value: 'DEPT_HEAD', label: '部门负责人（申请人所在部门）' },
  { value: 'FINANCE', label: '财务' },
  { value: 'COMPANY_HEAD', label: '企业负责人' },
  { value: 'SPECIFIED_USER', label: '指定用户' },
];
const RULE_TYPE_LABEL = Object.fromEntries(RULE_TYPES.map((r) => [r.value, r.label]));
const OP_TYPES = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'in', label: '属于（in）' },
];
const OP_LABEL = Object.fromEntries(OP_TYPES.map((o) => [o.value, o.label]));
const STATUS_META = {
  DRAFT: { label: '草稿', type: 'info' },
  PUBLISHED: { label: '已发布', type: 'success' },
  DISABLED: { label: '已停用', type: 'danger' },
};
function statusMeta(s) {
  return STATUS_META[s] || { label: s, type: 'info' };
}

/* ---------- 模板列表 ---------- */
const templates = ref([]);
const loading = ref(false);
const deptOptions = ref([]);
const deptMap = computed(() => Object.fromEntries(deptOptions.value.map((d) => [d.id, d.name])));

/** 列表接口返回的 formSchema / flowConfig 是 JSON 字符串，安全解析 */
function parseJson(s) {
  if (!s) return { fields: [], nodes: [] };
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return { fields: [], nodes: [] };
  }
}

async function load() {
  loading.value = true;
  try {
    const rows = await adminListTemplates();
    templates.value = rows.map((r) => ({ ...r, schema: parseJson(r.formSchema), flow: parseJson(r.flowConfig) }));
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

// 业务数据变化（SSE refresh / 轮询）时自动刷新列表
watch(() => notify.refreshTick, () => { load(); });

function deptNames(ids) {
  return (ids || []).map((id) => deptMap.value[id] || `#${id}`).join('、');
}

/* ---------- 新建模板 ---------- */
const createVisible = ref(false);
const creating = ref(false);
const createForm = reactive({ name: '', description: '' });

function openCreate() {
  createForm.name = '';
  createForm.description = '';
  createVisible.value = true;
}

async function confirmCreate() {
  const name = createForm.name.trim();
  if (!name) { ElMessage.warning('请输入模板名称'); return; }
  creating.value = true;
  try {
    // 后端要求至少 1 个表单字段：预置一个示例字段，进入编辑器后可自由增删
    const payload = {
      name,
      description: createForm.description.trim(),
      applicableDepts: [],
      formSchema: { fields: [{ id: 'content', label: '内容', type: 'text', required: true }] },
      flowConfig: { nodes: [] },
    };
    const { id } = await adminCreateTemplate(payload);
    createVisible.value = false;
    ElMessage.success('模板草稿已创建');
    await load();
    const row = templates.value.find((t) => t.id === id);
    if (row) openEdit(row);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    creating.value = false;
  }
}

/* ---------- 内置模板只读查看 ---------- */
const viewVisible = ref(false);
const viewRow = ref(null);
const viewFields = computed(() => ((viewRow.value && viewRow.value.schema) || {}).fields || []);
const viewNodes = computed(() => ((viewRow.value && viewRow.value.flow) || {}).nodes || []);
const viewDeptText = computed(() => {
  if (!viewRow.value) return '';
  const ids = viewRow.value.applicableDepts || [];
  return ids.length ? deptNames(ids) : '全部部门';
});

function viewFieldLabel(id) {
  const f = viewFields.value.find((x) => x.id === id);
  return f ? f.label : id;
}

function condText(f) {
  if (!f.condition) return '-';
  const v = Array.isArray(f.condition.value) ? f.condition.value.join(',') : String(f.condition.value ?? '');
  return `当「${viewFieldLabel(f.condition.field)}」${OP_LABEL[f.condition.op] || f.condition.op}「${v}」时显示`;
}

function openView(row) {
  viewRow.value = row;
  viewVisible.value = true;
  ensureUsersLoaded();
}

/* ---------- 列表行操作：发布 / 启用停用 ---------- */
const publishErrorVisible = ref(false);
const publishError = ref('');

async function publishRow(row) {
  try {
    await ElMessageBox.confirm(
      '发布将校验模板配置并立即启用该版本，同编码（code）的旧版本自动停用；已提交的申请按提交时快照流转，不受影响。确定发布吗？',
      '发布确认',
      { type: 'warning', confirmButtonText: '发布' }
    );
  } catch { return; }
  try {
    await adminPublishTemplate(row.id);
    ElMessage.success('模板已发布并启用');
    load();
  } catch (e) {
    // 后端 400 返回多行错误列表（\n 分隔），弹窗内用 el-alert 保留换行展示
    publishError.value = e.message;
    publishErrorVisible.value = true;
  }
}

async function toggleRow(row) {
  const disabling = row.status === 'PUBLISHED';
  try {
    await ElMessageBox.confirm(
      disabling
        ? '停用后员工端将无法再发起该流程；已提交的申请按快照继续流转，不受影响。确定停用吗？'
        : '启用后员工端即可发起该流程。确定启用吗？',
      disabling ? '停用模板' : '启用模板',
      { type: 'warning', confirmButtonText: disabling ? '停用' : '启用' }
    );
  } catch { return; }
  try {
    await adminToggleTemplate(row.id);
    ElMessage.success(disabling ? '模板已停用' : '模板已启用');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

/* ---------- 编辑抽屉 ---------- */
const drawerVisible = ref(false);
const saving = ref(false);
const publishing = ref(false);
const editingId = ref(null);
const editingStatus = ref('DRAFT');
const form = reactive({ name: '', description: '', applicableDepts: [] });
const editingFields = ref([]); // formSchema.fields 编辑模型
const editingNodes = ref([]);  // flowConfig.nodes 编辑模型

function condValueToStr(v) {
  if (v === null || v === undefined) return '';
  return Array.isArray(v) ? v.join(',') : String(v);
}

/** 后端字段 → 编辑模型（amount 的 min/max 单位是分，转为元展示/输入） */
function fieldToEdit(f) {
  const e = {
    id: f.id || '',
    label: f.label || '',
    type: f.type || 'text',
    required: !!f.required,
    options: Array.isArray(f.options) ? [...f.options] : [],
    min: '',
    max: '',
    conditionField: (f.condition && f.condition.field) || '',
    conditionOp: (f.condition && f.condition.op) || 'eq',
    conditionValue: condValueToStr(f.condition && f.condition.value),
  };
  if (f.type === 'amount') {
    if (f.rules && f.rules.min != null) e.min = centsToYuan(f.rules.min);
    if (f.rules && f.rules.max != null) e.max = centsToYuan(f.rules.max);
  } else if (f.type === 'number') {
    if (f.rules && f.rules.min != null) e.min = String(f.rules.min);
    if (f.rules && f.rules.max != null) e.max = String(f.rules.max);
  }
  return e;
}

function nodeToEdit(n) {
  return {
    name: n.name || '',
    ruleType: (n.rule && n.rule.type) || 'DEPT_HEAD',
    userId: (n.rule && n.rule.user_id) || null,
  };
}

function openEdit(row) {
  editingId.value = row.id;
  editingStatus.value = row.status;
  form.name = row.name || '';
  form.description = row.description || '';
  form.applicableDepts = [...(row.applicableDepts || [])];
  editingFields.value = ((parseJson(row.formSchema) || {}).fields || []).map(fieldToEdit);
  editingNodes.value = ((parseJson(row.flowConfig) || {}).nodes || []).map(nodeToEdit);
  publishError.value = '';
  drawerVisible.value = true;
  ensureUserOptions();
}

function addField() {
  editingFields.value.push({
    id: '', label: '', type: 'text', required: false, options: [],
    min: '', max: '', conditionField: '', conditionOp: 'eq', conditionValue: '',
  });
}

function addNode() {
  editingNodes.value.push({ name: '', ruleType: 'DEPT_HEAD', userId: null });
}

function moveUp(arr, i) { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; } }
function moveDown(arr, i) { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; } }
function removeAt(arr, i) { arr.splice(i, 1); }

function fieldIdInvalid(f) {
  return !!f.id && !FIELD_ID_RE.test(f.id);
}

function refFieldLabel(id) {
  const t = editingFields.value.find((x) => x.id === id);
  return t ? (t.label || t.id) : id;
}

/** 条件目标字段：只能引用位置在前的字段（与发布校验口径一致）；已悬空的引用补兜底选项 */
function condFieldOptions(idx) {
  const cur = editingFields.value[idx];
  const opts = [];
  for (let i = 0; i < idx; i++) {
    const t = editingFields.value[i];
    if (t.id) opts.push({ value: t.id, label: `${t.label || t.id}（${t.id}）` });
  }
  if (cur.conditionField && !opts.some((o) => o.value === cur.conditionField)) {
    opts.push({ value: cur.conditionField, label: cur.conditionField });
  }
  return opts;
}

/** 校验编辑器内容，返回第一条错误信息（空字符串 = 通过）。requireNodes=true 时校验节点数 ≥2（发布口径） */
function validateEditor(requireNodes = false) {
  if (!form.name.trim()) return '请输入模板名称';
  if (!editingFields.value.length) return '至少需要 1 个表单字段';
  const ids = new Set();
  for (let i = 0; i < editingFields.value.length; i++) {
    const f = editingFields.value[i];
    if (!f.label.trim()) return `第 ${i + 1} 个字段缺少名称`;
    const id = f.id.trim();
    if (!FIELD_ID_RE.test(id)) return `字段「${f.label}」的标识不合法（需以小写字母开头，仅含小写字母/数字/下划线，最多 32 个字符）`;
    if (ids.has(id)) return `字段标识「${id}」重复`;
    ids.add(id);
    if (f.type === 'radio' && (f.options || []).map((o) => String(o).trim()).filter(Boolean).length < 2) {
      return `单选字段「${f.label}」至少需要 2 个选项`;
    }
    if (f.type === 'number' || f.type === 'amount') {
      let min; let max;
      if (f.type === 'amount') {
        // 金额范围：界面以元输入，元→分后存储
        if (String(f.min).trim()) {
          min = yuanToCents(f.min);
          if (min === null) return `金额字段「${f.label}」的最小值不是合法金额（最多两位小数）`;
        }
        if (String(f.max).trim()) {
          max = yuanToCents(f.max);
          if (max === null) return `金额字段「${f.label}」的最大值不是合法金额（最多两位小数）`;
        }
      } else {
        if (String(f.min).trim() !== '') {
          min = Number(f.min);
          if (!Number.isFinite(min)) return `数字字段「${f.label}」的最小值不是合法数字`;
        }
        if (String(f.max).trim() !== '') {
          max = Number(f.max);
          if (!Number.isFinite(max)) return `数字字段「${f.label}」的最大值不是合法数字`;
        }
      }
      if (min !== undefined && max !== undefined && min > max) return `字段「${f.label}」的最小值不能大于最大值`;
    }
    if (f.conditionField) {
      if (!ids.has(f.conditionField)) return `字段「${f.label}」的条件引用了不存在的字段：${f.conditionField}`;
      if (f.conditionOp === 'in' && !String(f.conditionValue).split(/[,，]/).map((s) => s.trim()).filter(Boolean).length) {
        return `字段「${f.label}」的 in 条件需要至少 1 个值（多个值用逗号分隔）`;
      }
    }
  }
  if (requireNodes && editingNodes.value.length < 2) return `审批节点至少需要 2 个（当前 ${editingNodes.value.length} 个）`;
  const names = new Set();
  for (let i = 0; i < editingNodes.value.length; i++) {
    const n = editingNodes.value[i];
    if (!n.name.trim()) return `第 ${i + 1} 个审批节点缺少名称`;
    if (names.has(n.name.trim())) return `审批节点名称重复：${n.name.trim()}`;
    names.add(n.name.trim());
    if (!n.ruleType) return `节点「${n.name}」缺少审批人规则`;
    if (n.ruleType === 'SPECIFIED_USER' && !n.userId) return `节点「${n.name}」需要指定审批用户`;
  }
  return '';
}

/** 组装提交 payload：amount 范围元→分、in 条件值拆分为数组 */
function buildPayload() {
  const fields = editingFields.value.map((f) => {
    const item = { id: f.id.trim(), label: f.label.trim(), type: f.type, required: !!f.required };
    if (f.type === 'radio') item.options = (f.options || []).map((o) => String(o).trim()).filter(Boolean);
    if (f.type === 'number' || f.type === 'amount') {
      const rules = {};
      if (f.type === 'amount') {
        if (String(f.min).trim()) rules.min = yuanToCents(f.min);
        if (String(f.max).trim()) rules.max = yuanToCents(f.max);
      } else {
        if (String(f.min).trim() !== '') rules.min = Number(f.min);
        if (String(f.max).trim() !== '') rules.max = Number(f.max);
      }
      if (Object.keys(rules).length) item.rules = rules;
    }
    if (f.conditionField) {
      const raw = String(f.conditionValue ?? '');
      item.condition = {
        field: f.conditionField,
        op: f.conditionOp,
        value: f.conditionOp === 'in' ? raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : raw,
      };
    }
    return item;
  });
  const nodes = editingNodes.value.map((n) => {
    const rule = { type: n.ruleType };
    if (n.ruleType === 'SPECIFIED_USER') rule.user_id = n.userId;
    return { name: n.name.trim(), rule };
  });
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    applicableDepts: form.applicableDepts || [],
    formSchema: { fields },
    flowConfig: { nodes },
  };
}

async function saveTemplate() {
  const err = validateEditor(false);
  if (err) { ElMessage.warning(err); return; }
  // ≥2 节点前端提示（仍允许保存草稿，但发布时无法通过校验）
  if (editingNodes.value.length < 2) {
    try {
      await ElMessageBox.confirm(
        '审批节点不足 2 个，发布时将无法通过校验。仍要保存草稿吗？',
        '提示',
        { type: 'warning', confirmButtonText: '仍要保存' }
      );
    } catch { return; }
  }
  // 已发布/已停用模板：保存会生成新版本草稿，提前提示
  if (editingStatus.value !== 'DRAFT') {
    try {
      await ElMessageBox.confirm(
        '该模板当前为「已发布 / 已停用」状态：保存将基于当前配置自动生成新版本草稿（版本号 +1），原版本保持不变，新版本需重新发布后才生效。是否继续？',
        '生成新版本草稿',
        { type: 'warning', confirmButtonText: '保存为新版本草稿' }
      );
    } catch { return; }
  }
  saving.value = true;
  try {
    const res = await adminUpdateTemplate(editingId.value, buildPayload());
    ElMessage.success('模板已保存');
    if (res && res.id && res.id !== editingId.value) {
      // 后端返回新版本草稿 id，编辑器切换到新草稿
      editingId.value = res.id;
      editingStatus.value = 'DRAFT';
    }
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function publishFromDrawer() {
  const err = validateEditor(true);
  if (err) { ElMessage.warning(err); return; }
  try {
    await ElMessageBox.confirm(
      '发布前会先保存当前修改，随后校验模板配置并启用该版本；同编码（code）的旧版本自动停用，已提交的申请按提交时快照流转，不受影响。确定发布吗？',
      '发布确认',
      { type: 'warning', confirmButtonText: '发布' }
    );
  } catch { return; }
  publishing.value = true;
  try {
    // 先保存（DRAFT 原位更新），再发布；后端校验失败时错误列表保留换行展示
    const res = await adminUpdateTemplate(editingId.value, buildPayload());
    if (res && res.id && res.id !== editingId.value) editingId.value = res.id;
    await adminPublishTemplate(editingId.value);
    ElMessage.success('模板已发布并启用');
    drawerVisible.value = false;
    await load();
  } catch (e) {
    publishError.value = e.message;
    await load();
  } finally {
    publishing.value = false;
  }
}

/* ---------- 指定用户选择器 ---------- */
const allUsers = ref([]);      // 用于回显已选用户的名称（取前 50 个用户）
const userOptions = ref([]);   // remote 搜索选项
const userSearching = ref(false);

async function ensureUsersLoaded() {
  if (allUsers.value.length) return;
  try {
    const { list } = await adminListUsers({ pageSize: 50 });
    allUsers.value = list || [];
  } catch { /* 名称回显失败时降级显示用户编号 */ }
}

function userName(id) {
  const u = allUsers.value.find((x) => x.id === id);
  return u ? u.name : `用户 #${id}`;
}

/** 打开编辑器时，把已选的指定用户补进选项，保证回显 */
async function ensureUserOptions() {
  await ensureUsersLoaded();
  for (const n of editingNodes.value) {
    if (n.ruleType === 'SPECIFIED_USER' && n.userId && !userOptions.value.some((u) => u.id === n.userId)) {
      const u = allUsers.value.find((x) => x.id === n.userId);
      if (u) userOptions.value.push(u);
    }
  }
}

async function searchUserRemote(q) {
  if (!q) return;
  userSearching.value = true;
  try {
    userOptions.value = await searchUsers(q);
  } catch { /* 忽略搜索失败 */ } finally {
    userSearching.value = false;
  }
}

/* ---------- 初始化 ---------- */
onMounted(() => {
  load();
  adminListDepartments()
    .then((list) => { deptOptions.value = list || []; })
    .catch(() => { /* 部门加载失败不影响列表 */ });
});
</script>

<style scoped>
.list-head { flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.mech-item {
  display: flex; gap: 8px; font-size: 13px;
  color: var(--el-text-color-regular); line-height: 1.6; margin: 6px 0;
}
.mech-dot {
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%;
  background: var(--el-color-primary-light-9); color: var(--el-color-primary);
  font-size: 12px; display: inline-flex; align-items: center; justify-content: center; margin-top: 2px;
}
.section-title {
  font-weight: 600; margin: 4px 0 12px;
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.designer-card {
  border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
  padding: 10px 12px 0; margin-bottom: 12px; background: var(--el-fill-color-blank);
}
.card-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;
}
.card-head-title { font-weight: 600; font-size: 13px; color: var(--el-color-primary); }
.drawer-head { font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.head-tag { margin-left: 4px; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
/* 多行错误列表保留换行 */
.pre-line { white-space: pre-line; line-height: 1.7; }
.cond-hint { font-size: 12px; padding-top: 6px; }
.node-list { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.node-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.node-idx {
  width: 22px; height: 22px; border-radius: 50%; background: var(--el-color-primary); color: #fff;
  font-size: 12px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.node-name { font-weight: 600; }
.node-arrow { color: var(--el-text-color-secondary); font-size: 16px; }
</style>
