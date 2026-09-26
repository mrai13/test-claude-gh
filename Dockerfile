# The login + data API. No npm dependencies: only Node built-ins (http, crypto, sqlite).
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
