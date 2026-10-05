FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY web web
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server/src server/src
COPY --chown=node:node database database
COPY --from=build --chown=node:node /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/src/index.js"]
