FROM node:20-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_ROOT=/app/storage
ENV FFMPEG_PATH=ffmpeg
ENV FFPROBE_PATH=ffprobe
ENV YT_DLP_PATH=yt-dlp

RUN mkdir -p /app/storage

EXPOSE 3000

CMD ["npm", "run", "start"]
