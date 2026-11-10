# Self-host image: docker compose up (see docker-compose.yml), or bring your own
# Postgres with -e DATABASE_URL=... Tables create themselves on the first request.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
RUN npm ci
COPY . .
RUN npx turbo run build --filter=web && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["npm", "start", "-w", "web"]
