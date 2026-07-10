FROM node:20-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-liberation \
    fonts-roboto \
    ca-certificates \
    curl \
    python3 \
    python3-pip \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && yt-dlp --version \
  && ffmpeg -hide_banner -filters 2>&1 | grep -q subtitles \
  && fc-match "Arial" \
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
ENV FFMPEG_LOW_MEMORY=1
ENV FFMPEG_THREADS=1
ENV NODE_OPTIONS=--max-old-space-size=384

RUN mkdir -p /app/storage

EXPOSE 3000

CMD ["npm", "run", "start"]
