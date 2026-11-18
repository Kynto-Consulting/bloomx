# syntax=docker/dockerfile:1
# BloomX (Next.js 16 + Prisma/Postgres) para Capsule. `npm start` corre prestart (ensure-schema, DDL aditivo) antes de next start.
FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# El lockfile se genero en Windows: le faltan los binarios nativos linux de Tailwind/LightningCSS (mismas versiones que el lock).
RUN npm ci --include=dev --no-audit --no-fund \
    && npm install --no-save --no-audit --no-fund @tailwindcss/oxide-linux-x64-gnu@4.2.2 lightningcss-linux-x64-gnu@1.32.0

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://mail.tumi-ai.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=3072
# lib/env.ts valida estas variables al importar los modulos; en el build solo hacen falta valores de relleno.
# Los reales llegan en tiempo de ejecucion y no quedan en la imagen final (esta etapa no se copia con su ENV).
# next build directo: el prebuild (ensure-schema) tocaria la base en tiempo de build; se hace al arrancar.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    RESEND_API_KEY=build NEXTAUTH_SECRET=build \
    npx next build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
