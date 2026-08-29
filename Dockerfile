FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

FROM dependencies AS build

# Build-time only. Production builds keep the safe default unless explicitly overridden.
ARG VITE_ENABLE_VISUAL_AUDIT_ROUTES=false
ENV VITE_ENABLE_VISUAL_AUDIT_ROUTES=$VITE_ENABLE_VISUAL_AUDIT_ROUTES

COPY backend ./backend
COPY frontend ./frontend
COPY landing-public ./landing-public
COPY scripts ./scripts

RUN npm run db:generate
RUN npm run build
RUN rm -rf backend/dist/src/tests

FROM dependencies AS migration

ENV NODE_ENV=production

COPY backend/prisma ./backend/prisma

CMD ["npm", "run", "db:migrate:deploy"]

FROM node:22-bookworm-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --omit=dev --ignore-scripts --workspace backend --include-workspace-root \
  && rm -rf node_modules/prisma node_modules/@prisma/config node_modules/deepmerge-ts \
  && rm -f node_modules/.bin/prisma

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV UPLOADS_DIR=/data/uploads

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/landing-public ./landing-public
COPY --from=build /app/scripts ./scripts

RUN chown -R node:node /app /data

USER node

EXPOSE 4000

CMD ["npm", "run", "start:prod"]
