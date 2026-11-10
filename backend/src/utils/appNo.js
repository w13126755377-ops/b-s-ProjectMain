/**
 * 申请编号生成器（服务端唯一）：
 * 格式：{前缀}{YYYYMMDD}-{当日4位序号}，如 CG20261110-0001
 * 前缀：CG=采购 CX=差旅 BX=报销 SP=自定义
 * 通过 app_no_seq 表行锁保证并发唯一，applications.app_no 唯一索引兜底。
 */
const PREFIX = {
  PROCUREMENT: 'CG',
  TRAVEL: 'CX',
  REIMBURSEMENT: 'BX',
  CUSTOM: 'SP',
};

/** 生成申请编号。conn 可传事务连接（提交时在事务内生成） */
export async function generateAppNo(conn, type) {
  const prefix = PREFIX[type] || 'SP';
  const date = formatDate(new Date());
  const [rows] = await conn.execute(
    `INSERT INTO app_no_seq (\`type\`, \`date\`, seq) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE seq = seq + 1`,
    [type, date]
  );
  // ON DUPLICATE KEY UPDATE 后需要再查一次得到最终 seq
  const [seqRows] = await conn.execute(
    'SELECT seq FROM app_no_seq WHERE `type` = ? AND `date` = ?',
    [type, date]
  );
  const seq = seqRows[0].seq;
  return `${prefix}${date}-${String(seq).padStart(4, '0')}`;
}

/** 本地日期 YYYYMMDD（容器统一 TZ=Asia/Shanghai） */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
