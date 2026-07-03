# Stream Clipper

AI-powered YouTube livestream clip generator. Paste a stream URL, detect hype moments from chat and media signals, auto-download the video, and render vertical 9:16 Shorts.

## Tech Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS
- **PostgreSQL** + **Prisma** + **pgvector** for embeddings
- **OpenAI** for embeddings and AI chat
- **YouTube Data API** for metadata and live chat
- **FFmpeg** for video processing and Short rendering
- Local file storage (designed for S3/R2 migration)

## Quick Start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL 15+ with [pgvector](https://github.com/pgvector/pgvector) extension
- FFmpeg and FFprobe on your PATH (or set `FFMPEG_PATH` / `FFPROBE_PATH`)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your PATH (or set `YT_DLP_PATH`) — downloads video from the YouTube URL
- YouTube Data API key
- OpenAI API key

### 2. Setup

```bash
cp .env.example .env
# Edit .env with your keys and DATABASE_URL

npm install

# Enable pgvector in PostgreSQL, then:
npx prisma db push

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Database: Supabase (recommended)

1. Create a project at [supabase.com](https://supabase.com)
2. **Database → Extensions** → enable **vector**
3. **Project Settings → Database** → copy connection strings into `.env`:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` (add `?pgbouncer=true` at the end)
   - **Direct connection** (port `5432`) → `DIRECT_URL`
4. Replace `[YOUR-PASSWORD]` with your database password

```bash
npx prisma db push
```

### 3b. Database: Local PostgreSQL (alternative)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Or use Docker with pgvector:

```bash
docker run -d --name stream-clipper-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=stream_clipper \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Set both `DATABASE_URL` and `DIRECT_URL` to the same local connection string.

## MVP Demo Flow

1. Paste a YouTube livestream or VOD URL on the homepage
2. Workspace loads with embedded YouTube player and metadata
3. Start chat tracking (if live chat is available)
4. Video auto-downloads from the YouTube URL (or click **Download from YouTube**)
5. Click **Process Video** for transcript/audio/visual analysis
6. Ask AI: *"Make me 3 Shorts from the best moments"*
7. Click clip cards to seek the player; click **Render Short**
8. Download the rendered 1080×1920 MP4

## Project Structure

```
app/              # Pages and API routes
components/       # React UI components
lib/              # Core utilities (youtube, rag, ffmpeg, embeddings)
services/         # Business logic services
prisma/           # Database schema
storage/          # Local uploads, frames, renders
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | OpenAI API key (optional if using OpenRouter) |
| `OPENROUTER_API_KEY` | OpenRouter key — routes chat/embeddings/Whisper through cheaper models |
| `OPENROUTER_CHAT_MODEL` | Chat model slug (default: `google/gemini-2.0-flash-001`) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `STORAGE_ROOT` | Local storage path (default: `./storage`) |
| `FFMPEG_PATH` | FFmpeg binary (default: `ffmpeg`) |
| `FFPROBE_PATH` | FFprobe binary (default: `ffprobe`) |

## Architecture Notes

- **YouTube player** is for preview and timestamp sync
- **yt-dlp** downloads the video from your pasted URL for processing and rendering
- **Rendering** requires the download to finish first
- **Transcription** uses a stub provider by default — swap via `setTranscriptionProvider()` in `services/transcriptService.ts`
- **Facecam/visual** detection uses stub interfaces ready for real CV models
- **Chat polling** is endpoint-based; migrate to a background worker for production

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/sessions` | Create session from YouTube URL |
| GET | `/api/sessions/[id]` | Get session details |
| POST | `/api/sessions/[id]/chat/start` | Start/poll live chat |
| GET | `/api/sessions/[id]/chat` | Get chat messages |
| GET | `/api/sessions/[id]/events` | Get all signal events |
| POST | `/api/sessions/[id]/download-source` | Download video from YouTube URL |
| POST | `/api/sessions/[id]/upload-source` | Optional manual file upload |
| POST | `/api/sessions/[id]/process-video` | Run media processing |
| POST | `/api/sessions/[id]/ask` | AI chat with RAG |
| POST | `/api/clips/[id]/save` | Save clip suggestion |
| POST | `/api/clips/[id]/reject` | Reject clip suggestion |
| POST | `/api/clips/[id]/render` | Render vertical Short |
| GET | `/api/render-jobs/[id]` | Get render job status |

## License

MIT
