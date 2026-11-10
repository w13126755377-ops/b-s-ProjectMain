<template>
  <div class="file-upload">
    <el-upload
      :show-file-list="false"
      :http-request="doUpload"
      :disabled="disabled || !applicationId"
      accept=".jpg,.jpeg,.png,.pdf"
      multiple
    >
      <el-button :disabled="disabled || !applicationId" size="small" :icon="Upload">
        {{ uploadText }}
      </el-button>
    </el-upload>
    <div class="hint">{{ hint }}</div>

    <ul v-if="ownAttachments.length" class="att-list">
      <li v-for="att in ownAttachments" :key="att.id" class="att-item">
        <el-icon :class="att.mime && att.mime.startsWith('image/') ? 'is-img' : 'is-pdf'">
          <Picture v-if="att.mime && att.mime.startsWith('image/')" />
          <Document v-else />
        </el-icon>
        <a class="att-name" :href="attachmentContentUrl(att.id)" target="_blank" rel="noopener">{{ att.original_name }}</a>
        <span class="att-size">{{ formatBytes(att.size_bytes) }}</span>
        <el-button
          v-if="!disabled"
          link
          type="danger"
          size="small"
          :icon="Delete"
          @click="removeAtt(att)"
        >删除</el-button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Upload, Picture, Document, Delete } from '@element-plus/icons-vue';
import { uploadAttachment, deleteAttachment, attachmentContentUrl } from '@/api';
import { formatBytes } from '@/utils/format';

const props = defineProps({
  /** 所属申请 id（草稿保存后才有；为空时禁用上传） */
  applicationId: { type: Number, default: null },
  /** 业务类型：QUOTATION/TRAVEL/RECEIPT/CUSTOM */
  bizType: { type: String, required: true },
  /** 已选附件 id 列表（v-model） */
  modelValue: { type: Array, default: () => [] },
  /** 该申请的全部附件（详情接口返回），用于展示列表 */
  attachments: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  /** 最多可选数量 */
  limit: { type: Number, default: 20 },
  uploadText: { type: String, default: '上传文件' },
  hint: { type: String, default: '支持 JPEG / PNG / PDF，单文件 ≤ 10MB' },
});

const emit = defineEmits(['update:modelValue']);

/** 本组件会话内新上传的附件（详情接口是保存前取的，不包含刚上传的文件） */
const localUploads = ref([]);

const ownAttachments = computed(() => [
  ...(props.attachments || []).filter((a) => a.biz_type === props.bizType),
  ...localUploads.value,
]);

async function doUpload({ file }) {
  if (ownAttachments.value.length >= props.limit) {
    ElMessage.warning(`最多上传 ${props.limit} 个文件`);
    return;
  }
  try {
    const data = await uploadAttachment(props.applicationId, props.bizType, file);
    localUploads.value.push({
      id: data.id, biz_type: props.bizType, original_name: file.name,
      mime: file.type || '', size_bytes: file.size,
    });
    emit('update:modelValue', [...props.modelValue, data.id]);
    ElMessage.success('上传成功');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function removeAtt(att) {
  try {
    await deleteAttachment(att.id);
    localUploads.value = localUploads.value.filter((a) => a.id !== att.id);
    emit('update:modelValue', props.modelValue.filter((id) => id !== att.id));
    ElMessage.success('已删除');
  } catch (e) {
    ElMessage.error(e.message);
  }
}
</script>

<style scoped>
.hint { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.att-list { list-style: none; padding: 0; margin: 8px 0 0; }
.att-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px; margin-bottom: 6px; background: var(--el-fill-color-light);
}
.att-item .el-icon.is-img { color: var(--el-color-success); }
.att-item .el-icon.is-pdf { color: var(--el-color-danger); }
.att-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.att-size { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
