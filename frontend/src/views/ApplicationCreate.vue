<template>
  <div class="app-create" v-loading="loading">
    <!-- 顶部：返回按钮 + 标题 -->
    <div class="page-head">
      <el-button :icon="ArrowLeft" @click="goBack">返回</el-button>
      <div>
        <div class="page-title">{{ isEdit ? '编辑草稿' : '发起申请' }}</div>
        <div v-if="isEdit && appNo" class="text-muted">
          单号：{{ appNo }} · {{ TYPE_LABEL[currentType] || currentType }}
        </div>
      </div>
    </div>

    <!-- 部门归属未确认：禁止提交 -->
    <el-alert
      v-if="!auth.deptConfirmed"
      class="mb16"
      type="warning"
      show-icon
      :closable="false"
      title="您的部门归属尚未经管理员确认，暂时无法提交申请；可先保存草稿，并联系管理员在「用户管理」中确认部门。"
    />

    <!-- 编辑模式兜底：仅草稿可编辑 -->
    <el-alert
      v-if="formDisabled"
      class="mb16"
      type="error"
      show-icon
      :closable="false"
      title="该申请当前不是草稿状态（仅草稿可编辑），以下内容仅供查看。"
    >
      <el-button link type="primary" @click="router.push(`/apps/${appId}`)">前往详情页</el-button>
    </el-alert>

    <!-- ==================== 第一步：选择流程（仅新建） ==================== -->
    <template v-if="!isEdit && !currentType">
      <div class="card">
        <h3 class="card-title">内置流程</h3>
        <el-row :gutter="12">
          <el-col v-for="t in builtinTemplates" :key="t.id" :xs="24" :sm="8" class="tpl-col">
            <div class="tpl-card" @click="selectBuiltin(t)">
              <div class="tpl-name">
                <el-icon class="tpl-icon"><component :is="builtinIcon(t.type)" /></el-icon>
                <span>{{ t.name }}</span>
              </div>
              <div class="tpl-desc">{{ t.description }}</div>
              <div class="text-muted">版本 v{{ t.version }}</div>
            </div>
          </el-col>
        </el-row>
      </div>

      <div class="card" v-if="customTemplates.length">
        <h3 class="card-title">自定义流程</h3>
        <el-row :gutter="12">
          <el-col v-for="t in customTemplates" :key="t.id" :xs="24" :sm="8" class="tpl-col">
            <div class="tpl-card" @click="selectCustom(t)">
              <div class="tpl-name">
                <el-icon class="tpl-icon"><DocumentCopy /></el-icon>
                <span>{{ t.name }}</span>
              </div>
              <div class="tpl-desc">{{ t.description }}</div>
              <div class="text-muted">版本 v{{ t.version }}</div>
            </div>
          </el-col>
        </el-row>
      </div>

      <el-empty v-if="!loading && !builtinTemplates.length && !customTemplates.length" description="暂无可发起的流程" />
    </template>

    <!-- ==================== 第二步：表单 ==================== -->
    <template v-if="currentType">
      <div v-if="!isEdit" class="card form-head">
        <div class="flex flex-between flex-wrap gap8">
          <div>
            已选流程：<strong>{{ selectedName }}</strong>
            <span v-if="currentType === 'CUSTOM' && customTemplate" class="text-muted">（v{{ customTemplate.version }}）</span>
          </div>
          <el-button link type="primary" :icon="RefreshLeft" @click="resetSelection">重新选择流程</el-button>
        </div>
      </div>

      <!-- ---------- 采购申请 ---------- -->
      <el-form
        v-if="currentType === 'PROCUREMENT'"
        ref="procFormRef"
        :model="procurement"
        :rules="procRules"
        :disabled="formDisabled"
        :label-position="labelPos"
        label-width="110px"
        status-icon
      >
        <div class="card">
          <h3 class="card-title">采购申请信息</h3>
          <el-row :gutter="16">
            <el-col :xs="24" :sm="12">
              <el-form-item label="标题" prop="title">
                <el-input v-model="procurement.title" maxlength="100" placeholder="请输入申请标题" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="所属项目">
                <el-input v-model="procurement.project" maxlength="100" placeholder="选填，如：XX 机房改造项目" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="期望到货日期" prop="expectedArrivalDate">
                <el-date-picker v-model="procurement.expectedArrivalDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="预算上限" prop="budgetCap">
                <el-input v-model="procurement.budgetCap" placeholder="请输入金额（元）">
                  <template #prefix>¥</template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="采购原因" prop="reason">
                <el-input v-model="procurement.reason" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="请说明采购原因" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="procurement.remark" type="textarea" :rows="2" maxlength="500" placeholder="选填" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="card">
          <div class="flex flex-between flex-wrap gap8 mb16">
            <h3 class="card-title" style="margin: 0">采购明细（至少 2 条）</h3>
            <el-button type="primary" plain :icon="Plus" :disabled="formDisabled" @click="addItem">添加明细</el-button>
          </div>
          <div v-for="(it, idx) in procurement.items" :key="it._uid" class="row-card">
            <div class="row-fields">
              <div class="field">
                <span class="field-label">物品/服务名称 *</span>
                <el-input v-model="it.name" maxlength="100" placeholder="如：戴尔显示器 U2723QE" />
              </div>
              <div class="field">
                <span class="field-label">规格型号</span>
                <el-input v-model="it.spec" maxlength="100" placeholder="选填" />
              </div>
              <div class="field field-sm">
                <span class="field-label">数量 *</span>
                <el-input-number v-model="it.quantity" :min="0" :controls="false" class="w-full" placeholder="0" />
              </div>
              <div class="field field-sm">
                <span class="field-label">单位 *</span>
                <el-input v-model="it.unit" maxlength="20" placeholder="台 / 个 / 套" />
              </div>
              <div class="field">
                <span class="field-label">预计单价（元）*</span>
                <el-input v-model="it.unitPrice" placeholder="0.00">
                  <template #prefix>¥</template>
                </el-input>
              </div>
            </div>
            <div class="row-ops">
              <span class="text-muted">金额小计：<span class="row-amount">{{ itemSubtotalText(it) }}</span>（数量 × 单价，服务端会重算）</span>
              <el-button link type="danger" :icon="Delete" :disabled="formDisabled" @click="removeItem(idx)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="!procurement.items.length" description="暂无明细，请点击「添加明细」" :image-size="60" />
        </div>

        <div class="card">
          <div class="flex flex-between flex-wrap gap8 mb16">
            <h3 class="card-title" style="margin: 0">报价比较（至少 1 家，须且仅选 1 家拟选）</h3>
            <el-button type="primary" plain :icon="Plus" :disabled="formDisabled" @click="addQuotation">添加报价</el-button>
          </div>
          <div v-for="(q, idx) in procurement.quotations" :key="q._uid" class="row-card">
            <div class="row-fields">
              <div class="field">
                <span class="field-label">供应商名称 *</span>
                <el-input v-model="q.supplierName" maxlength="100" placeholder="供应商名称" />
              </div>
              <div class="field">
                <span class="field-label">报价日期 *</span>
                <el-date-picker v-model="q.quoteDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="w-full" />
              </div>
              <div class="field">
                <span class="field-label">报价金额（元）*</span>
                <el-input v-model="q.quoteAmount" placeholder="0.00">
                  <template #prefix>¥</template>
                </el-input>
              </div>
              <div class="field field-full">
                <span class="field-label">报价说明</span>
                <el-input v-model="q.quoteDetail" type="textarea" :rows="2" maxlength="500" placeholder="报价明细说明（选填）" />
              </div>
              <div class="field field-sm">
                <span class="field-label">线上购买</span>
                <el-switch v-model="q.online" />
              </div>
              <div class="field" v-if="q.online">
                <span class="field-label">购买链接 *</span>
                <el-input v-model="q.purchaseLink" maxlength="300" placeholder="https://..." />
              </div>
              <div class="field field-full">
                <span class="field-label">
                  报价依据附件<span v-if="q.online" class="text-danger">（线上购买须上传截图等依据）</span>
                </span>
                <FileUpload
                  v-model="q.attachmentIds"
                  :application-id="appId"
                  biz-type="QUOTATION"
                  :attachments="quoteAttachments(q)"
                  :disabled="formDisabled"
                  :limit="5"
                />
              </div>
              <div class="field field-sm">
                <span class="field-label">拟选供应商</span>
                <el-radio-group :model-value="selectedQuoteIdx" @change="selectQuote">
                  <el-radio :value="idx">拟选</el-radio>
                </el-radio-group>
              </div>
            </div>
            <div class="row-ops">
              <span />
              <el-button link type="danger" :icon="Delete" :disabled="formDisabled" @click="removeQuotation(idx)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="!procurement.quotations.length" description="暂无报价，请点击「添加报价」" :image-size="60" />

          <!-- 单一来源提示：仅 1 家报价时显示 -->
          <div v-if="procurement.quotations.length === 1" class="warn-block">
            当前仅 1 家报价，属于<b>单一来源采购</b>：请务必填写下方「单一来源说明」，审批界面将明确展示。
          </div>
          <!-- 未选最低价提示（最低价由前端计算） -->
          <div v-if="selectedNotLowest" class="warn-block">
            所选供应商报价（¥{{ selectedQuoteAmountText }}）不是最低报价（最低 ¥{{ minQuoteAmountText }}），请务必在「拟选理由」中说明原因。
          </div>

          <el-row :gutter="16">
            <el-col v-if="procurement.quotations.length === 1" :span="24">
              <el-form-item label="单一来源说明" prop="singleSourceReason">
                <el-input v-model="procurement.singleSourceReason" type="textarea" :rows="2" maxlength="500" placeholder="请说明为什么只能从该供应商采购" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="拟选理由" prop="selectReason">
                <el-input v-model="procurement.selectReason" type="textarea" :rows="2" maxlength="500" placeholder="请说明选择该供应商的理由" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </el-form>

      <!-- ---------- 差旅申请 ---------- -->
      <el-form
        v-else-if="currentType === 'TRAVEL'"
        ref="travelFormRef"
        :model="travel"
        :rules="travelRules"
        :disabled="formDisabled"
        :label-position="labelPos"
        label-width="110px"
        status-icon
      >
        <div class="card">
          <h3 class="card-title">差旅申请信息</h3>
          <el-row :gutter="16">
            <el-col :xs="24" :sm="12">
              <el-form-item label="标题" prop="title">
                <el-input v-model="travel.title" maxlength="100" placeholder="请输入申请标题" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="目的地" prop="destination">
                <el-input v-model="travel.destination" maxlength="100" placeholder="如：北京" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="出发地点" prop="departure">
                <el-input v-model="travel.departure" maxlength="100" placeholder="如：上海" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="交通方式" prop="transport">
                <el-input v-model="travel.transport" maxlength="50" placeholder="如：高铁 / 飞机" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="开始时间" prop="startTime">
                <el-date-picker v-model="travel.startTime" type="datetime" value-format="YYYY-MM-DD HH:mm" placeholder="选择开始时间" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="结束时间" prop="endTime">
                <el-date-picker v-model="travel.endTime" type="datetime" value-format="YYYY-MM-DD HH:mm" placeholder="选择结束时间" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="同行人员">
                <el-select
                  v-model="travel.companions"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入姓名后按回车添加，可添加多人"
                  class="w-full"
                >
                  <el-option v-for="c in travel.companions" :key="c" :label="c" :value="c" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="费用预算" prop="budget">
                <el-input v-model="travel.budget" placeholder="请输入金额（元）">
                  <template #prefix>¥</template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="出差目的" prop="purpose">
                <el-input v-model="travel.purpose" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="请说明出差目的" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="travel.remark" type="textarea" :rows="2" maxlength="500" placeholder="选填" />
              </el-form-item>
            </el-col>
          </el-row>
          <div class="days-box">
            出差天数（系统计算，口径：自然日-时长折算，不足一天按一天计）：
            <span class="amount-strong">{{ travelDaysCount }} 天</span>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">差旅附件</h3>
          <FileUpload
            v-model="travel.attachmentIds"
            :application-id="appId"
            biz-type="TRAVEL"
            :attachments="detail ? detail.attachments || [] : []"
            :disabled="formDisabled"
          />
        </div>
      </el-form>

      <!-- ---------- 报销申请 ---------- -->
      <el-form
        v-else-if="currentType === 'REIMBURSEMENT'"
        ref="reimbFormRef"
        :model="reimbursement"
        :rules="reimbRules"
        :disabled="formDisabled"
        :label-position="labelPos"
        label-width="110px"
        status-icon
      >
        <div class="card">
          <h3 class="card-title">报销申请信息</h3>
          <el-row :gutter="16">
            <el-col :xs="24" :sm="12">
              <el-form-item label="标题" prop="title">
                <el-input v-model="reimbursement.title" maxlength="100" placeholder="请输入申请标题" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="关联申请">
                <el-select
                  v-model="reimbursement.linkedApplicationId"
                  clearable
                  filterable
                  placeholder="可选：关联本人已批准的差旅/采购申请"
                  class="w-full"
                >
                  <el-option v-for="o in linkedOptions" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="报销说明" prop="description">
                <el-input v-model="reimbursement.description" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="请说明报销内容" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="reimbursement.remark" type="textarea" :rows="2" maxlength="500" placeholder="选填" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="card">
          <div class="flex flex-between flex-wrap gap8 mb16">
            <h3 class="card-title" style="margin: 0">费用明细（至少 3 条）</h3>
            <el-button type="primary" plain :icon="Plus" :disabled="formDisabled" @click="addExpenseItem">添加明细</el-button>
          </div>
          <div v-for="(it, idx) in reimbursement.expenseItems" :key="it._uid" class="row-card">
            <div class="row-fields">
              <div class="field field-sm">
                <span class="field-label">费用类型 *</span>
                <el-select v-model="it.expenseType" placeholder="选择类型" class="w-full">
                  <el-option v-for="o in expenseTypeOptions" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </div>
              <div class="field">
                <span class="field-label">发生日期 *</span>
                <el-date-picker v-model="it.occurDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="w-full" />
              </div>
              <div class="field">
                <span class="field-label">金额（元）*</span>
                <el-input v-model="it.amount" placeholder="0.00">
                  <template #prefix>¥</template>
                </el-input>
              </div>
              <div class="field">
                <span class="field-label">用途说明 *</span>
                <el-input v-model="it.purpose" maxlength="200" placeholder="如：上海-北京高铁票" />
              </div>
              <div class="field">
                <span class="field-label">票据号</span>
                <el-input v-model="it.receiptNo" maxlength="64" placeholder="选填" />
              </div>
              <div class="field field-sm">
                <span class="field-label">无票支出</span>
                <el-switch v-model="it.noReceipt" />
              </div>
              <div v-if="it.noReceipt" class="field field-full">
                <span class="field-label">无票原因 *</span>
                <el-input v-model="it.noReceiptReason" type="textarea" :rows="2" maxlength="200" placeholder="请说明无法提供票据的原因" />
              </div>
              <div v-else class="field field-full">
                <span class="field-label">票据（至少 1 份，同一票据不可用于多条明细）</span>
                <FileUpload
                  v-model="it.attachmentIds"
                  :application-id="appId"
                  biz-type="RECEIPT"
                  :attachments="receiptAttachments(it)"
                  :disabled="formDisabled"
                  :limit="10"
                />
              </div>
            </div>
            <!-- 同一单内相同票据号 / 附件的前端去重提示 -->
            <div v-if="rowDupTips(it).length" class="warn-block">{{ rowDupTips(it).join('；') }}</div>
            <div class="row-ops">
              <span />
              <el-button link type="danger" :icon="Delete" :disabled="formDisabled" @click="removeExpenseItem(idx)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="!reimbursement.expenseItems.length" description="暂无明细，请点击「添加明细」" :image-size="60" />

          <div class="total-box">
            合计金额：<span class="amount-strong">{{ centsToYuanText(reimbTotalCents) }} 元</span>
            <span class="text-muted">（仅供参考，最终以服务端重算为准）</span>
          </div>
        </div>
      </el-form>

      <!-- ---------- 自定义流程 ---------- -->
      <el-form
        v-else-if="currentType === 'CUSTOM'"
        ref="customFormRef"
        :model="customForm"
        :rules="customRules"
        :disabled="formDisabled"
        :label-position="labelPos"
        label-width="130px"
        status-icon
      >
        <div class="card">
          <h3 class="card-title">
            {{ customTemplate ? customTemplate.name : '自定义流程' }}
            <span v-if="customTemplate" class="text-muted" style="font-weight: normal">（版本 v{{ customTemplate.version }}）</span>
          </h3>
          <el-form-item label="标题" prop="title">
            <el-input v-model="customForm.title" maxlength="100" placeholder="请输入申请标题" />
          </el-form-item>
          <!-- 按模板 formSchema.fields 动态渲染；条件显隐与后端逻辑一致，隐藏字段跳过必填 -->
          <template v-for="f in customFields" :key="f.id">
            <el-form-item v-if="fieldVisible(f)" :label="f.label" :prop="f.id" :required="f.required" :rules="customFieldRules(f)">
              <el-input
                v-if="f.type === 'text'"
                v-model="customForm[f.id]"
                :maxlength="(f.rules && f.rules.max_length) || 200"
                :placeholder="f.placeholder || `请输入${f.label}`"
              />
              <el-input
                v-else-if="f.type === 'textarea'"
                v-model="customForm[f.id]"
                type="textarea"
                :rows="3"
                :maxlength="(f.rules && f.rules.max_length) || 500"
                :placeholder="f.placeholder || `请输入${f.label}`"
              />
              <el-input-number
                v-else-if="f.type === 'number'"
                v-model="customForm[f.id]"
                :min="f.rules ? f.rules.min : undefined"
                :max="f.rules ? f.rules.max : undefined"
                controls-position="right"
                class="w-full"
              />
              <el-input
                v-else-if="f.type === 'amount'"
                v-model="customForm[f.id]"
                :placeholder="f.placeholder || '请输入金额（元）'"
              >
                <template #prefix>¥</template>
              </el-input>
              <el-date-picker
                v-else-if="f.type === 'date'"
                v-model="customForm[f.id]"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                class="w-full"
              />
              <el-radio-group v-else-if="f.type === 'radio'" v-model="customForm[f.id]">
                <el-radio v-for="o in f.options" :key="o" :value="o">{{ o }}</el-radio>
              </el-radio-group>
              <FileUpload
                v-else-if="f.type === 'attachment'"
                v-model="customForm[f.id]"
                :application-id="appId"
                biz-type="CUSTOM"
                :attachments="customFieldAttachments(f)"
                :disabled="formDisabled"
                :limit="20"
              />
              <el-input v-else v-model="customForm[f.id]" />
            </el-form-item>
          </template>
        </div>
      </el-form>

      <!-- ---------- 操作区 ---------- -->
      <div v-if="!formDisabled" class="card actions">
        <div class="flex flex-wrap gap8">
          <el-button type="primary" :loading="submitting" :disabled="!auth.deptConfirmed" @click="onSubmit">提交申请</el-button>
          <el-button :loading="saving" @click="onSave">保存草稿</el-button>
          <el-button v-if="isEdit" type="danger" plain :icon="Delete" @click="onDelete">删除草稿</el-button>
        </div>
        <div class="text-muted mt8">
          提交后不可修改；票据/附件需先保存草稿（生成申请单号）后才能上传。
          <span v-if="!auth.deptConfirmed" class="text-danger">部门归属未确认前无法提交。</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * 发起 / 编辑申请（新建：先选流程再填表单；编辑：仅草稿，直接回填渲染）
 * 金额输入一律"元"字符串，提交前 yuanToCents 转"分"并校验。
 */
import { ref, reactive, computed, watch, onMounted, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Plus, Delete, RefreshLeft, ShoppingCart, Van, Wallet } from '@element-plus/icons-vue';
import {
  publishedTemplates, getApplication, createApplication, updateApplication,
  submitApplication, deleteApplication, listApplications,
} from '@/api';
import FileUpload from '@/components/FileUpload.vue';
import { useAuthStore } from '@/stores/auth';
import { useMobile } from '@/utils/useMobile';
import { yuanToCents, centsToYuan, centsToYuanText, TYPE_LABEL, EXPENSE_TYPE_LABEL } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const isMobile = useMobile();
// 移动端标签置顶，避免挤压输入区
const labelPos = computed(() => (isMobile.value ? 'top' : 'right'));

const isEdit = computed(() => route.name === 'app-edit');
// 新建时 appId 为 null → FileUpload 自动禁用；首次保存后生效
const appId = ref(isEdit.value ? Number(route.params.id) : null);
const appNo = ref('');
const detail = ref(null); // 编辑模式：详情数据（含明细/附件）

const currentType = ref(''); // 当前表单类型：PROCUREMENT/TRAVEL/REIMBURSEMENT/CUSTOM
const selectedTemplateId = ref(null);
const customTemplate = ref(null); // 自定义流程模板（name/version/schema）

const builtinTemplates = ref([]);
const customTemplates = ref([]);
const linkedOptions = ref([]); // 可关联的已批准差旅/采购申请

const loading = ref(true);
const saving = ref(false);
const submitting = ref(false);

// 仅草稿可编辑（后端兜底，此处只读展示）
const formDisabled = computed(() => isEdit.value && !!detail.value && detail.value.status !== 'DRAFT');

/* ================= 表单模型与默认值 ================= */
const procurement = reactive({});
const travel = reactive({});
const reimbursement = reactive({});
const customForm = reactive({});
const selectedQuoteIdx = ref(-1); // 拟选供应商下标（须且仅 1 家）

// 明细行稳定 key：v-for 用 _uid 而非数组下标，避免删除行后复用组件状态（如 FileUpload）
let uidSeed = 0;
const nextUid = () => `r${++uidSeed}`;

function newItem() {
  return { _uid: nextUid(), name: '', spec: '', quantity: 1, unit: '', unitPrice: '' };
}
function newQuotation() {
  return { _uid: nextUid(), supplierName: '', quoteDate: '', quoteAmount: '', quoteDetail: '', online: false, purchaseLink: '', attachmentIds: [], selected: false };
}
function newExpenseItem() {
  return { _uid: nextUid(), expenseType: '', occurDate: '', purpose: '', amount: '', receiptNo: '', noReceipt: false, noReceiptReason: '', attachmentIds: [] };
}

function resetProcurement() {
  Object.assign(procurement, {
    title: '', reason: '', project: '', expectedArrivalDate: '', budgetCap: '', remark: '',
    items: [newItem(), newItem()], quotations: [newQuotation(), newQuotation()],
    singleSourceReason: '', selectReason: '',
  });
  selectedQuoteIdx.value = -1;
}
function resetTravel() {
  Object.assign(travel, {
    title: '', destination: '', departure: '', startTime: '', endTime: '',
    purpose: '', companions: [], transport: '', budget: '', remark: '', attachmentIds: [],
  });
}
function resetReimbursement() {
  Object.assign(reimbursement, {
    title: '', description: '', linkedApplicationId: null, remark: '',
    expenseItems: [newExpenseItem(), newExpenseItem(), newExpenseItem()],
  });
}
/** 重置自定义表单：字段默认值 + 回填（金额分→元字符串） */
function resetCustomForm(fields, formData, title = '') {
  const fresh = { title };
  for (const f of fields || []) {
    const v = (formData || {})[f.id];
    if (f.type === 'amount') fresh[f.id] = v !== undefined && v !== null && v !== '' ? centsToYuan(v) : '';
    else if (f.type === 'attachment') fresh[f.id] = Array.isArray(v) ? [...v] : [];
    else if (f.type === 'number') fresh[f.id] = v !== undefined && v !== null && v !== '' ? Number(v) : undefined;
    else fresh[f.id] = v !== undefined && v !== null ? v : '';
  }
  for (const k of Object.keys(customForm)) delete customForm[k];
  Object.assign(customForm, fresh);
}

function setCustomTemplate(t) {
  if (!t) { customTemplate.value = null; return; }
  // formSchema 可能是对象（publishedTemplates/详情）或 JSON 字符串（admin 列表）
  let schema = t.formSchema || t.form_schema || {};
  if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = {}; } }
  customTemplate.value = { name: t.name || '', version: t.version, schema: schema || {} };
}
const customFields = computed(() => (customTemplate.value && customTemplate.value.schema && customTemplate.value.schema.fields) || []);

const BUILTIN_ICONS = { PROCUREMENT: ShoppingCart, TRAVEL: Van, REIMBURSEMENT: Wallet };
function builtinIcon(type) { return BUILTIN_ICONS[type] || ShoppingCart; }
const selectedName = computed(() => {
  if (currentType.value === 'CUSTOM') return (customTemplate.value && customTemplate.value.name) || '自定义流程';
  return TYPE_LABEL[currentType.value] || currentType.value;
});
const expenseTypeOptions = Object.entries(EXPENSE_TYPE_LABEL).map(([value, label]) => ({ value, label }));

/* ================= 校验规则 ================= */
const req = (label) => ({ required: true, message: `${label}不能为空`, trigger: ['blur', 'change'] });
/** 金额（元字符串）必填 + 格式校验 */
const moneyRule = (label) => ({
  validator: (rule, value, cb) => {
    if (value === '' || value === undefined || value === null) return cb(new Error(`请输入${label}`));
    if (yuanToCents(value) === null) return cb(new Error(`${label}格式不正确（最多两位小数）`));
    cb();
  },
  trigger: 'blur',
});

const procRules = {
  title: req('标题'),
  reason: req('采购原因'),
  expectedArrivalDate: req('期望到货日期'),
  budgetCap: moneyRule('预算上限'),
  selectReason: req('拟选理由'),
  // 单一来源说明：仅 1 家报价时必填（输入框同时只在该情况下渲染）
  singleSourceReason: [{
    validator: (rule, value, cb) => {
      if (procurement.quotations.length === 1 && !(value || '').trim()) return cb(new Error('单一来源采购必须填写说明'));
      cb();
    },
    trigger: 'blur',
  }],
};

const travelRules = {
  title: req('标题'),
  destination: req('目的地'),
  departure: req('出发地点'),
  startTime: req('开始时间'),
  endTime: [
    { required: true, message: '结束时间不能为空', trigger: ['blur', 'change'] },
    {
      validator: (rule, value, cb) => {
        if (value && travel.startTime && new Date(String(value).replace(' ', 'T')) <= new Date(travel.startTime.replace(' ', 'T'))) {
          return cb(new Error('结束时间必须晚于开始时间'));
        }
        cb();
      },
      trigger: ['blur', 'change'],
    },
  ],
  purpose: req('出差目的'),
  transport: req('交通方式'),
  budget: moneyRule('费用预算'),
};

const reimbRules = {
  title: req('标题'),
  description: req('报销说明'),
};

const customRules = { title: req('标题') };

/** 自定义字段规则：required 显示红星，金额/数字附加格式与范围校验 */
function customFieldRules(f) {
  const rs = [];
  if (f.required) rs.push({ required: true, message: `${f.label}不能为空`, trigger: ['blur', 'change'] });
  if (f.type === 'amount') {
    rs.push({
      validator: (rule, value, cb) => {
        if (value === '' || value === undefined || value === null) return cb();
        const c = yuanToCents(value);
        if (c === null) return cb(new Error('金额格式不正确（最多两位小数）'));
        if (f.rules && f.rules.min !== undefined && c < f.rules.min) return cb(new Error(`不能小于 ${f.rules.min / 100} 元`));
        if (f.rules && f.rules.max !== undefined && c > f.rules.max) return cb(new Error(`不能大于 ${f.rules.max / 100} 元`));
        cb();
      },
      trigger: 'blur',
    });
  } else if (f.type === 'number') {
    rs.push({
      validator: (rule, value, cb) => {
        if (value === '' || value === undefined || value === null) return cb();
        const n = Number(value);
        if (!Number.isFinite(n)) return cb(new Error('必须为数字'));
        if (f.rules && f.rules.min !== undefined && n < f.rules.min) return cb(new Error(`不能小于 ${f.rules.min}`));
        if (f.rules && f.rules.max !== undefined && n > f.rules.max) return cb(new Error(`不能大于 ${f.rules.max}`));
        cb();
      },
      trigger: 'blur',
    });
  }
  return rs;
}

/* ================= 动态计算 ================= */
/** 采购明细金额小计（数量 × 单价，展示用；服务端重算为准） */
function itemSubtotalText(it) {
  const q = Number(it.quantity);
  const p = yuanToCents(it.unitPrice);
  if (!Number.isFinite(q) || q <= 0 || p === null) return '-';
  return '¥' + centsToYuanText(Math.round(q * p));
}

const quoteAmountsCents = computed(() =>
  procurement.quotations.map((q) => yuanToCents(q.quoteAmount)).filter((c) => c !== null));
const selectedQuote = computed(() =>
  selectedQuoteIdx.value >= 0 ? procurement.quotations[selectedQuoteIdx.value] : null);
const minQuoteAmountText = computed(() =>
  quoteAmountsCents.value.length ? centsToYuanText(Math.min(...quoteAmountsCents.value)) : '-');
const selectedQuoteAmountText = computed(() =>
  selectedQuote.value && yuanToCents(selectedQuote.value.quoteAmount) !== null
    ? centsToYuanText(yuanToCents(selectedQuote.value.quoteAmount)) : '-');
/** 未选最低价（最低价由前端计算） */
const selectedNotLowest = computed(() => {
  if (procurement.quotations.length < 2 || !selectedQuote.value) return false;
  const sel = yuanToCents(selectedQuote.value.quoteAmount);
  if (sel === null) return false;
  return sel > Math.min(...quoteAmountsCents.value);
});

/** 出差天数 = ceil((结束-开始)/24h)，口径：自然日-时长折算，不足一天按一天计 */
const travelDaysCount = computed(() => {
  if (!travel.startTime || !travel.endTime) return 0;
  const ms = new Date(String(travel.endTime).replace(' ', 'T')).getTime()
    - new Date(travel.startTime.replace(' ', 'T')).getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
});

/** 报销合计（展示仅供参考，服务端会重算） */
const reimbTotalCents = computed(() => {
  let total = 0;
  for (const it of reimbursement.expenseItems) {
    const c = yuanToCents(it.amount);
    if (c !== null) total += c;
  }
  return total;
});

/** 同一单内重复票据号 / 重复附件 id（前端去重提示） */
const dupReceiptNos = computed(() => {
  const cnt = new Map(); const dup = new Set();
  for (const it of reimbursement.expenseItems) {
    const no = (it.receiptNo || '').trim();
    if (!no) continue;
    if (cnt.has(no)) dup.add(no); else cnt.set(no, 1);
  }
  return dup;
});
const dupAttIds = computed(() => {
  const cnt = new Map(); const dup = new Set();
  for (const it of reimbursement.expenseItems) {
    for (const id of it.attachmentIds || []) {
      if (cnt.has(id)) dup.add(id); else cnt.set(id, 1);
    }
  }
  return dup;
});
function rowDupTips(it) {
  const tips = [];
  const no = (it.receiptNo || '').trim();
  if (no && dupReceiptNos.value.has(no)) tips.push(`票据号「${no}」与本单其他明细重复`);
  const dupIds = (it.attachmentIds || []).filter((id) => dupAttIds.value.has(id));
  if (dupIds.length) tips.push(`${dupIds.length} 份票据文件与本单其他明细重复使用`);
  return tips;
}

/* ================= 自定义表单：提交值构造与条件显隐（与后端一致） ================= */
/** 提交时 formData：amount 元→分、number 转数字，空值跳过，其余原样 */
function customSubmitValues() {
  const out = {};
  for (const f of customFields.value) {
    const v = customForm[f.id];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'amount') { const c = yuanToCents(v); if (c !== null) out[f.id] = c; }
    else if (f.type === 'number') out[f.id] = Number(v);
    else out[f.id] = v;
  }
  return out;
}
// 条件求值基于"提交值视图"（金额为分），与后端 templateService 求值口径一致
const submitView = computed(() => customSubmitValues());
function fieldVisible(f) {
  if (!f.condition) return true;
  const refVal = submitView.value[f.condition.field];
  const cmp = f.condition.value;
  switch (f.condition.op) {
    case 'eq': return refVal === cmp;
    case 'neq': return refVal !== cmp;
    case 'gt': return Number(refVal) > Number(cmp);
    case 'lt': return Number(refVal) < Number(cmp);
    case 'in': return Array.isArray(cmp) && cmp.includes(refVal);
    default: return true;
  }
}

/* ================= 附件展示（仅本行 attachmentIds 对应的附件对象） ================= */
function filterAttachments(bizType, ids) {
  const list = (detail.value && detail.value.attachments) || [];
  const idSet = new Set(ids || []);
  return list.filter((a) => a.biz_type === bizType && idSet.has(a.id));
}
const quoteAttachments = (q) => filterAttachments('QUOTATION', q.attachmentIds);
const receiptAttachments = (it) => filterAttachments('RECEIPT', it.attachmentIds);
const customFieldAttachments = (f) => filterAttachments('CUSTOM', customForm[f.id]);

/* ================= 明细行操作 ================= */
const addItem = () => procurement.items.push(newItem());
const removeItem = (idx) => procurement.items.splice(idx, 1);
const addQuotation = () => procurement.quotations.push(newQuotation());
function removeQuotation(idx) {
  procurement.quotations.splice(idx, 1);
  // 维护拟选下标：删除拟选行需重新选择，删除其前部行则下标前移
  if (selectedQuoteIdx.value === idx) selectedQuoteIdx.value = -1;
  else if (selectedQuoteIdx.value > idx) selectedQuoteIdx.value -= 1;
}
const selectQuote = (v) => { selectedQuoteIdx.value = v; };
const addExpenseItem = () => reimbursement.expenseItems.push(newExpenseItem());
const removeExpenseItem = (idx) => reimbursement.expenseItems.splice(idx, 1);

/* ================= 表格区手动校验（el-form 不覆盖动态行） ================= */
const warn = (m) => { ElMessage.warning(m); return false; };

function validateProcurement() {
  const items = procurement.items;
  if (items.length < 2) return warn('采购明细至少 2 条');
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tag = `第 ${i + 1} 条明细`;
    if (!(it.name || '').trim()) return warn(`${tag}：名称不能为空`);
    if (it.quantity === null || it.quantity === undefined || Number(it.quantity) <= 0) return warn(`${tag}：数量必须大于 0`);
    if (!(it.unit || '').trim()) return warn(`${tag}：单位不能为空`);
    if (yuanToCents(it.unitPrice) === null) return warn(`${tag}：单价格式不正确（最多两位小数）`);
  }
  const quotes = procurement.quotations;
  if (quotes.length < 1) return warn('报价至少 1 家');
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const tag = `第 ${i + 1} 家报价`;
    if (!(q.supplierName || '').trim()) return warn(`${tag}：供应商名称不能为空`);
    if (!q.quoteDate) return warn(`${tag}：请选择报价日期`);
    if (yuanToCents(q.quoteAmount) === null) return warn(`${tag}：报价金额格式不正确（最多两位小数）`);
    if (q.online) {
      if (!/^https?:\/\/.+/.test((q.purchaseLink || '').trim())) return warn(`${tag}：线上购买必须提供购买链接`);
      if (!(q.attachmentIds || []).length) return warn(`${tag}：线上购买必须上传截图等报价依据附件`);
    }
  }
  if (selectedQuoteIdx.value < 0 || selectedQuoteIdx.value >= quotes.length) return warn('必须且只能选择 1 家拟选供应商');
  if (quotes.length === 1 && !procurement.singleSourceReason.trim()) return warn('单一来源采购必须填写说明');
  if (!procurement.selectReason.trim()) return warn('必须填写选择该供应商的理由');
  return true;
}

function validateReimbursement() {
  const rows = reimbursement.expenseItems;
  if (rows.length < 3) return warn('费用明细至少 3 条');
  const seenNos = new Set();
  const seenAtts = new Set();
  for (let i = 0; i < rows.length; i++) {
    const it = rows[i];
    const tag = `第 ${i + 1} 条明细`;
    if (!it.expenseType) return warn(`${tag}：请选择费用类型`);
    if (!it.occurDate) return warn(`${tag}：请选择发生日期`);
    if (!(it.purpose || '').trim()) return warn(`${tag}：请填写用途说明`);
    const c = yuanToCents(it.amount);
    if (c === null) return warn(`${tag}：金额格式不正确（最多两位小数）`);
    if (c <= 0) return warn(`${tag}：金额必须大于 0`);
    if (it.noReceipt) {
      if (!(it.noReceiptReason || '').trim()) return warn(`${tag}：无票支出必须填写原因`);
    } else if (!(it.attachmentIds || []).length) {
      return warn(`${tag}：至少关联 1 份票据（或勾选「无票支出」；票据需先保存草稿后上传）`);
    }
    const no = (it.receiptNo || '').trim();
    if (no) {
      if (seenNos.has(no)) return warn(`${tag}：票据号「${no}」与本单其他明细重复`);
      seenNos.add(no);
    }
    for (const id of it.attachmentIds || []) {
      if (seenAtts.has(id)) return warn(`${tag}：同一票据文件不能重复使用`);
      seenAtts.add(id);
    }
  }
  return true;
}

const procFormRef = ref(null);
const travelFormRef = ref(null);
const reimbFormRef = ref(null);
const customFormRef = ref(null);

/** 整体校验：el-form 规则 + 动态行手动校验 */
async function validateAll() {
  const refMap = { PROCUREMENT: procFormRef, TRAVEL: travelFormRef, REIMBURSEMENT: reimbFormRef, CUSTOM: customFormRef };
  const fr = refMap[currentType.value];
  if (fr && fr.value) {
    try { await fr.value.validate(); } catch { return false; }
  }
  if (currentType.value === 'PROCUREMENT') return validateProcurement();
  if (currentType.value === 'REIMBURSEMENT') return validateReimbursement();
  return true;
}

/* ================= 载荷构造（元→分） ================= */
function buildPayload() {
  if (currentType.value === 'PROCUREMENT') {
    return {
      type: 'PROCUREMENT',
      title: procurement.title.trim(),
      reason: procurement.reason.trim(),
      expectedArrivalDate: procurement.expectedArrivalDate,
      project: (procurement.project || '').trim(),
      budgetCapCents: yuanToCents(procurement.budgetCap),
      remark: (procurement.remark || '').trim(),
      items: procurement.items.map((it) => ({
        name: it.name.trim(),
        spec: (it.spec || '').trim(),
        quantity: Number(it.quantity),
        unit: it.unit.trim(),
        unitPriceCents: yuanToCents(it.unitPrice),
      })),
      quotations: procurement.quotations.map((q, i) => ({
        supplierName: q.supplierName.trim(),
        quoteDate: q.quoteDate,
        quoteAmountCents: yuanToCents(q.quoteAmount),
        quoteDetail: (q.quoteDetail || '').trim(),
        online: !!q.online,
        purchaseLink: (q.purchaseLink || '').trim(),
        attachmentIds: q.attachmentIds || [],
        selected: i === selectedQuoteIdx.value,
      })),
      singleSourceReason: (procurement.singleSourceReason || '').trim(),
      selectReason: procurement.selectReason.trim(),
    };
  }
  if (currentType.value === 'TRAVEL') {
    return {
      type: 'TRAVEL',
      title: travel.title.trim(),
      destination: travel.destination.trim(),
      departure: travel.departure.trim(),
      startTime: travel.startTime,
      endTime: travel.endTime,
      purpose: travel.purpose.trim(),
      companions: (travel.companions || []).map((s) => String(s).trim()).filter(Boolean),
      companionUserIds: [],
      transport: travel.transport.trim(),
      budgetCents: yuanToCents(travel.budget),
      remark: (travel.remark || '').trim(),
      attachmentIds: travel.attachmentIds || [],
    };
  }
  if (currentType.value === 'REIMBURSEMENT') {
    return {
      type: 'REIMBURSEMENT',
      title: reimbursement.title.trim(),
      description: reimbursement.description.trim(),
      linkedApplicationId: reimbursement.linkedApplicationId || null,
      remark: (reimbursement.remark || '').trim(),
      expenseItems: reimbursement.expenseItems.map((it) => ({
        expenseType: it.expenseType,
        occurDate: it.occurDate,
        purpose: (it.purpose || '').trim(),
        amountCents: yuanToCents(it.amount),
        receiptNo: (it.receiptNo || '').trim(),
        noReceipt: !!it.noReceipt,
        noReceiptReason: (it.noReceiptReason || '').trim(),
        attachmentIds: it.attachmentIds || [],
      })),
    };
  }
  return {
    type: 'CUSTOM',
    templateId: selectedTemplateId.value,
    title: customForm.title.trim(),
    formData: customSubmitValues(),
  };
}
/** 编辑接口不接受 type/templateId（服务端按库内类型校验） */
function stripMeta(payload) {
  const { type, templateId, ...rest } = payload;
  return rest;
}

/* ================= 保存 / 提交 / 删除 ================= */
async function onSave() {
  if (!(await validateAll())) return;
  saving.value = true;
  try {
    const payload = buildPayload();
    if (appId.value) {
      const res = await updateApplication(appId.value, stripMeta(payload));
      ElMessage.success('草稿已保存');
      if (res.warnings && res.warnings.length) await showWarnings(res.warnings);
    } else {
      // 新建首次保存：拿到 appId（FileUpload 的 application-id 生效）后跳转详情
      const res = await createApplication(payload);
      appId.value = res.id;
      ElMessage.success('草稿已保存，可上传附件');
      router.push(`/apps/${appId.value}`);
    }
  } catch (e) { showApiError(e); } finally { saving.value = false; }
}

async function onSubmit() {
  if (!(await validateAll())) return;
  if (!auth.deptConfirmed) { ElMessage.warning('您的部门归属尚未经管理员确认，暂时无法提交申请'); return; }
  submitting.value = true;
  try {
    // 尚未保存草稿先保存拿 appId；编辑模式同步保存一次，确保刚上传的附件落入明细
    const payload = buildPayload();
    if (!appId.value) {
      const res = await createApplication(payload);
      appId.value = res.id;
    } else {
      await updateApplication(appId.value, stripMeta(payload));
    }
    try {
      await ElMessageBox.confirm('提交后不可修改，确定提交该申请吗？', '提交确认', {
        type: 'warning', confirmButtonText: '确定提交', cancelButtonText: '再检查一下',
      });
    } catch { return; }
    const res = await submitApplication(appId.value);
    // 跨申请重复票据预警（不阻断提交）
    if (res.warnings && res.warnings.length) await showWarnings(res.warnings);
    ElMessage.success('提交成功，进入审批流程');
    router.push(`/apps/${appId.value}`);
  } catch (e) { showApiError(e); } finally { submitting.value = false; }
}

async function onDelete() {
  try {
    await ElMessageBox.confirm('删除后不可恢复，确定删除该草稿吗？', '删除草稿', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    });
  } catch { return; }
  try {
    await deleteApplication(appId.value);
    ElMessage.success('草稿已删除');
    router.push('/apps');
  } catch (e) { showApiError(e); }
}

/* ================= 提示与错误处理 ================= */
/** 跨申请重复票据预警列表（warn-block 展示） */
async function showWarnings(warnings) {
  const items = warnings.map((w) => h('div', { class: 'warn-block' }, [
    h('div', `申请单 ${w.appNo}（${w.title}，申请人：${w.applicantName || '-'}）中存在与本单重复的票据：`),
    w.receiptNo ? h('div', `票据号：${w.receiptNo}`) : null,
    w.fileName ? h('div', `文件名：${w.fileName}`) : null,
  ]));
  try {
    await ElMessageBox.alert(
      h('div', [
        h('div', { style: 'margin-bottom:8px' }, '检测到以下跨申请重复票据（仅预警、不阻断提交，请知悉）：'),
        ...items,
      ]),
      '重复票据预警',
      { type: 'warning', confirmButtonText: '知道了' },
    );
  } catch { /* 忽略关闭 */ }
}

function showApiError(e) {
  if (e && Array.isArray(e.errors) && e.errors.length) {
    ElMessage.error(e.errors.slice(0, 6).map((x) => x.message).join('；'));
  } else {
    ElMessage.error((e && e.message) || '操作失败');
  }
}

function goBack() {
  if (window.history.state && window.history.state.back) router.back();
  else router.push('/apps');
}

/* ================= 数据加载 ================= */
async function loadTemplates() {
  loading.value = true;
  try {
    const data = await publishedTemplates();
    builtinTemplates.value = data.builtin || [];
    customTemplates.value = data.custom || [];
  } catch (e) { showApiError(e); } finally { loading.value = false; }
}

/** 报销关联申请：本人已批准的差旅/采购（服务端兜底校验） */
async function loadLinkedOptions() {
  try {
    const data = await listApplications({ status: 'APPROVED', pageSize: 50 });
    linkedOptions.value = (data.list || [])
      .filter((a) => a.type === 'TRAVEL' || a.type === 'PROCUREMENT')
      .map((a) => ({ value: a.id, label: `${a.app_no} ${a.title}` }));
  } catch { /* 选项加载失败不阻塞表单填写 */ }
}

/** 编辑模式回填：form_data + 明细数据（items/quotations/expenseItems 来自详情） */
function backfill(d) {
  const f = d.form_data || {};
  if (d.type === 'PROCUREMENT') {
    procurement.title = d.title || '';
    procurement.reason = f.reason || '';
    procurement.expectedArrivalDate = f.expectedArrivalDate || '';
    procurement.project = f.project || '';
    procurement.budgetCap = f.budgetCapCents !== undefined && f.budgetCapCents !== null ? centsToYuan(f.budgetCapCents) : '';
    procurement.remark = f.remark || '';
    procurement.singleSourceReason = f.singleSourceReason || '';
    procurement.selectReason = f.selectReason || '';
    procurement.items = (d.items || []).map((it) => ({
      _uid: nextUid(),
      name: it.name || '', spec: it.spec || '', quantity: it.quantity, unit: it.unit || '',
      unitPrice: it.unit_price_cents !== undefined && it.unit_price_cents !== null ? centsToYuan(it.unit_price_cents) : '',
    }));
    procurement.quotations = (d.quotations || []).map((q) => ({
      _uid: nextUid(),
      supplierName: q.supplier_name || '',
      quoteDate: q.quote_date || '',
      quoteAmount: q.quote_amount_cents !== undefined && q.quote_amount_cents !== null ? centsToYuan(q.quote_amount_cents) : '',
      quoteDetail: q.quote_detail || '',
      online: !!q.online,
      purchaseLink: q.purchase_link || '',
      attachmentIds: q.attachmentIds || (q.attachment_ids ? safeParseArray(q.attachment_ids) : []),
      selected: !!q.selected,
    }));
    selectedQuoteIdx.value = procurement.quotations.findIndex((q) => q.selected);
  } else if (d.type === 'TRAVEL') {
    travel.title = d.title || '';
    travel.destination = f.destination || '';
    travel.departure = f.departure || '';
    travel.startTime = f.startTime || '';
    travel.endTime = f.endTime || '';
    travel.purpose = f.purpose || '';
    travel.companions = Array.isArray(f.companions) ? [...f.companions] : [];
    travel.transport = f.transport || '';
    travel.budget = f.budgetCents !== undefined && f.budgetCents !== null ? centsToYuan(f.budgetCents) : '';
    travel.remark = f.remark || '';
    travel.attachmentIds = Array.isArray(f.attachmentIds) ? [...f.attachmentIds] : [];
  } else if (d.type === 'REIMBURSEMENT') {
    reimbursement.title = d.title || '';
    reimbursement.description = f.description || '';
    reimbursement.remark = f.remark || '';
    reimbursement.linkedApplicationId = d.linked_application_id || null;
    reimbursement.expenseItems = (d.expenseItems || []).map((it) => ({
      _uid: nextUid(),
      expenseType: it.expense_type || '',
      occurDate: it.occur_date || '',
      purpose: it.purpose || '',
      amount: it.amount_cents !== undefined && it.amount_cents !== null ? centsToYuan(it.amount_cents) : '',
      receiptNo: it.receipt_no || '',
      noReceipt: !!it.no_receipt,
      noReceiptReason: it.no_receipt_reason || '',
      attachmentIds: (it.receipts || []).map((r) => r.attachment_id),
    }));
  } else if (d.type === 'CUSTOM') {
    setCustomTemplate(d.template);
    resetCustomForm(customFields.value, f, d.title || '');
  }
}

function safeParseArray(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function loadEdit() {
  loading.value = true;
  try {
    const d = await getApplication(appId.value);
    detail.value = d;
    currentType.value = d.type;
    appNo.value = d.app_no;
    selectedTemplateId.value = d.template_id || null;
    if (['PROCUREMENT', 'TRAVEL', 'REIMBURSEMENT', 'CUSTOM'].includes(d.type)) {
      backfill(d);
      if (d.type === 'REIMBURSEMENT') loadLinkedOptions();
    } else {
      ElMessage.warning('暂不支持该申请类型的编辑');
      router.push('/apps');
    }
  } catch (e) {
    showApiError(e);
    router.push('/apps');
  } finally { loading.value = false; }
}

/* ================= 流程选择 ================= */
function selectBuiltin(t) {
  if (!['PROCUREMENT', 'TRAVEL', 'REIMBURSEMENT'].includes(t.type)) { ElMessage.warning('暂不支持该流程类型'); return; }
  currentType.value = t.type;
  selectedTemplateId.value = null;
  customTemplate.value = null;
  if (t.type === 'PROCUREMENT') resetProcurement();
  else if (t.type === 'TRAVEL') resetTravel();
  else { resetReimbursement(); loadLinkedOptions(); }
}
function selectCustom(t) {
  currentType.value = 'CUSTOM';
  selectedTemplateId.value = t.id;
  setCustomTemplate(t);
  resetCustomForm(customFields.value, null);
}
function resetSelection() {
  currentType.value = '';
  selectedTemplateId.value = null;
  customTemplate.value = null;
}

/* ================= 生命周期 ================= */
onMounted(async () => {
  if (isEdit.value) await loadEdit();
  else await loadTemplates();
});

// 同一路由记录下切换编辑 id（/apps/1/edit → /apps/2/edit）时重新加载
watch(() => route.params.id, async (id) => {
  if (route.name === 'app-edit' && id && Number(id) !== appId.value) {
    appId.value = Number(id);
    await loadEdit();
  }
});

// 开始时间变更后联动重校验结束时间（endTime ≥ startTime）
watch(() => travel.startTime, () => {
  if (travel.endTime && travelFormRef.value) travelFormRef.value.validateField('endTime').catch(() => {});
});
</script>

<style scoped>
.page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; }

/* 流程选择卡片 */
.tpl-col { margin-bottom: 12px; }
.tpl-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 14px;
  height: 100%;
  cursor: pointer;
  background: #fff;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.tpl-card:hover { border-color: var(--el-color-primary); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); }
.tpl-name { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
.tpl-icon { font-size: 20px; color: var(--el-color-primary); }
.tpl-desc { font-size: 13px; color: var(--el-text-color-secondary); margin: 8px 0; line-height: 1.5; }

.form-head { padding: 12px 16px; }

/* 动态明细行（卡片化，移动端友好） */
.row-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light);
}
.row-fields { display: flex; flex-wrap: wrap; gap: 10px 14px; }
.field { flex: 1 1 220px; min-width: 200px; }
.field-sm { flex: 0 1 130px; min-width: 120px; }
.field-full { flex-basis: 100%; }
.field-label { display: block; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.field .el-select, .field .el-date-editor, .field .el-input-number { width: 100%; }
.row-ops {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 10px; padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.row-amount { font-weight: 600; color: var(--el-color-primary); }

/* 天数 / 合计展示 */
.days-box, .total-box {
  margin-top: 12px; padding: 10px 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 6px; font-size: 14px;
}
.total-box { background: var(--el-fill-color-light); border: 1px solid var(--el-border-color-lighter); }

.actions { padding: 12px 16px; }

@media (max-width: 768px) {
  .field { flex-basis: 100%; }
  .field-sm { flex-basis: 48%; }
}
</style>
