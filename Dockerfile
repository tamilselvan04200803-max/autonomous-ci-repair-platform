# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd --system --uid 1001 --create-home aegis

COPY --from=build --chown=aegis:aegis /app/public ./public
COPY --from=build --chown=aegis:aegis /app/.next/standalone ./
COPY --from=build --chown=aegis:aegis /app/.next/static ./.next/static
COPY --from=build --chown=aegis:aegis /app/runner ./runner
COPY --from=build --chown=aegis:aegis /app/templates ./templates

USER aegis
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
