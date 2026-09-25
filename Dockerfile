# Stage 1: Build Frontend and Server
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# WICHTIG: Nur package.json kopieren, NICHT package*.json!
# Eine auf macOS generierte package-lock.json führt unter Linux zu inkompatiblen
# nativen Rollup/Esbuild-Binaries (siehe npm/cli#4828).
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

# Stage 2: Production Runner
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# System ffmpeg & ffprobe installieren
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# Gebaute Artefakte aus dem Builder übernehmen
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/dist ./server/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
