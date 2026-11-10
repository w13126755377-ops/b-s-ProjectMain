# 企业审批系统 后端镜像（Node 20 + Express）
FROM node:20-alpine

# 时区：统一东八区（Node 自带完整 ICU 时区数据）
ENV TZ=Asia/Shanghai \
    NODE_ENV=production

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 拷贝源码
COPY src ./src

# 附件持久化目录（docker-compose 挂载 volume）
RUN mkdir -p /app/uploads
VOLUME ["/app/uploads"]

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
