# 8K 平台：前端 + 后端同一个 Node 服务（零依赖，无需 npm install）
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=10000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    TRUST_PROXY=1 \
    HUIDU_SIMULATOR=on

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
# 运行时数据目录（JSON 持久化）；以非 root 的 node 用户运行
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
