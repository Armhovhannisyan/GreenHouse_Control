# API + static UI (greenhouse/). Build from repo root: docker compose build
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/server.js backend/ewelink-app.js backend/influx-writer.js backend/influx-drainage.js backend/paths.js ./
COPY greenhouse ./greenhouse

RUN mkdir -p db logs \
  && chown -R node:node /app

USER node
EXPOSE 3001
CMD ["node", "server.js"]
