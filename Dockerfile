FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --cache /tmp/npm-cache

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node","apps/web/server.js"]

FROM dependencies AS worker
WORKDIR /app
COPY --chown=node:node apps/web/lib apps/web/lib
COPY --chown=node:node scripts scripts
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/tsx","scripts/worker.ts"]
