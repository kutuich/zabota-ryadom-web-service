FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

COPY backend ./backend
COPY frontend ./frontend
COPY landing-public ./landing-public
COPY scripts ./scripts

RUN npm run db:generate
RUN npm run build
RUN rm -rf backend/dist/src/tests

FROM build AS production-deps

RUN rm -rf node_modules backend/node_modules frontend/node_modules \
  && npm ci --omit=dev --ignore-scripts --workspace backend --include-workspace-root \
  && npx prisma generate --schema backend/prisma/schema.prisma \
  && rm -rf node_modules/typescript node_modules/tsx node_modules/.bin/tsx

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL=file:/data/zabota.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /app/backend/uploads

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/landing-public ./landing-public
COPY --from=build /app/scripts ./scripts

RUN chown -R node:node /app /data

USER node

EXPOSE 4000

CMD ["npm", "run", "start:prod"]
