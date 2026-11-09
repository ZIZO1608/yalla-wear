FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Damascus DATA_DIR=/data PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ tzdata \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
