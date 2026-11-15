# Multi-stage build: web (Vite) + server (TypeScript/Prisma) -> one small runtime image.
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production WEB_DIST=/app/web/dist UPLOAD_DIR=/app/uploads PORT=4000
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci && npx prisma generate
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/prisma ./prisma
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /app/uploads
EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/index.js"]
