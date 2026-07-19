FROM brainicism/bgutil-ytdlp-pot-provider:1.3.1 AS pot-provider

FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-liberation \
    fonts-roboto \
    fonts-montserrat \
    ca-certificates \
    curl \
    python3 \
    python3-pip \
    libglib2.0-0 \
    libgomp1 \
  && pip3 install --break-system-packages --no-cache-dir --upgrade --pre \
    "yt-dlp[default,curl-cffi]" \
    "bgutil-ytdlp-pot-provider==1.3.1" \
  && node --version \
  && yt-dlp --version \
  && ffmpeg -hide_banner -filters 2>&1 | grep -q subtitles \
  && fc-match "Arial" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=pot-provider /app /opt/bgutil-ytdlp-pot-provider

# Facecam analysis worker (YuNet via OpenCV). Install before npm so the
# layer stays cached when only JS changes.
COPY workers/facecam/requirements.docker.txt ./workers/facecam/requirements.docker.txt
RUN pip3 install --break-system-packages --no-cache-dir \
      -r workers/facecam/requirements.docker.txt \
  && python3 -c "import cv2, numpy; print(f'opencv={cv2.__version__}')"

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
ENV YT_DLP_IMPERSONATE=chrome
ENV YT_DLP_YOUTUBE_CLIENT=mweb
ENV YT_DLP_POT_PROVIDER_URL=http://127.0.0.1:4416
ENV FFMPEG_LOW_MEMORY=1
ENV FFMPEG_THREADS=1
ENV WORKER_ENABLED=1
ENV NODE_OPTIONS=--max-old-space-size=384
ENV FACECAM_PYTHON=python3
ENV FACECAM_MODEL_DIR=/app/storage/.cache/clipper

RUN mkdir -p /app/storage /app/storage/.cache/clipper

EXPOSE 3000

CMD ["npm", "run", "start"]
