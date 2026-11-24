FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY dist/ai-schema.js ./dist/ai-schema.js
COPY backend/worker/index.js ./backend/worker/index.js
COPY backend/drizzle/0000_ai.sql ./backend/drizzle/0000_ai.sql
COPY backend/tencent/maps.mjs ./backend/tencent/maps.mjs
COPY backend/tencent/server.mjs ./backend/tencent/server.mjs
RUN chmod -R a+rX /app && mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "backend/tencent/server.mjs"]
