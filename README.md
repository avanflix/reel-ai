# Reel Analyser AI (Next.js)

Upload up to 30 reels from your device, click **Analyse**, and get each reel scored
and ranked on:

- **Editing** (cut rhythm, pacing, visual variety)
- **Lighting** (exposure, contrast, color grading)
- **Framing / "Taking"** (composition, shot quality, camera angle)
- **Music / Audio** (based on audio metadata — see note below)
- **Hook / Engagement** (how scroll-stopping the opening looks)
- **Overall score + rank** across the whole batch, plus actionable tips per reel

## Which AI this uses, and why

This app uses **Groq**, running **Llama 3.2 11B Vision** for per-reel analysis and
**Llama 3.1 8B Instant** for the final batch ranking pass, because:

- Groq's free tier has **no regional restriction** (unlike Gemini's free tier, which
  excludes some countries), so it's usable globally right now at zero cost.
- It's genuinely fast — Groq's whole pitch is low-latency inference.
- Vision quality on subtle judgments (lighting, composition nuance) is a notch below
  Claude or Gemini, but it's solid enough for editing/framing/hook feedback, and free
  tier limits make it a good fit for testing/dev before you commit to a paid provider.

**Important honesty note on "music" scoring:** no public API today lets a model literally
*listen* to and judge a song's audio quality/beat-matching in real time. So `music_audio`
scoring here is a **proxy** based on: presence/absence of an audio track, audio codec/bitrate,
and visual cues (e.g. cut timing suggesting beat-matched editing). The prompt is explicit
about this limitation. If you need true audio analysis (BPM detection, beat-matching to cuts,
loudness normalization checks), you'd pair this with an audio-specific library (e.g. `music-tempo`,
`essentia.js`, or a dedicated audio ML model) — there's a stub (`extractAudio`) already wired up
in `lib/ffmpegUtils.js` ready for that extension.

**Free tier limits to know:** Groq's free tier has requests-per-minute and tokens-per-minute
caps that vary by model and change over time — check current numbers at
https://console.groq.com/settings/limits once you're logged in. Analyzing 30 reels means many
sequential calls (multiple frames per reel + a final ranking call), so on the free tier you may
hit rate limits mid-batch on large batches — if that happens, wait a bit and retry, or reduce
`FRAMES_PER_REEL` in `pages/api/analyze.js` to send fewer images per reel.

**Note on model names:** Groq rotates/renames preview vision models periodically. If you get a
"model not found" error, check current model IDs at https://console.groq.com/docs/models and
update `MODEL_NAME` in `lib/groqAnalyzer.js`.

## How it works

1. You drag/drop or select up to 30 video files in the browser.
2. They're uploaded to `/api/analyze` (Next.js API route).
3. For each video, the server uses `ffmpeg` to:
   - Pull technical metadata (duration, resolution, fps, audio codec/bitrate)
   - Extract 6 evenly-spaced JPEG keyframes
4. Each reel's frames + metadata are sent to Groq (one frame per message, since Groq's
   vision models currently handle one image per turn reliably), which returns
   structured JSON scores + reasons + tips after seeing all frames.
5. Once every reel is scored, a final **batch ranking pass** sends all reels'
   scores back to Groq together so it can produce a consistent 1→N ranking
   and one-line verdict per reel (this avoids inconsistent scoring across
   separate calls).
6. Results are shown ranked best → worst with full category breakdowns.

## Setup

### 1. Prerequisites

- Node.js 18+
- A free Groq API key (see below)

> Note: `ffmpeg-static` and `ffprobe-static` ship prebuilt binaries via npm,
> so you do **not** need to separately install ffmpeg on your system.

### 2. Create your Groq API key

1. Go to https://console.groq.com/
2. Sign up or log in (GitHub/Google login supported — no credit card required for free tier)
3. In the left sidebar, click **API Keys** (or go directly to https://console.groq.com/keys)
4. Click **Create API Key**, give it a name (e.g. "reel-analyser"), and copy the key
   immediately — it starts with `gsk_...` and is only shown once
5. Keep it somewhere safe; you'll paste it into `.env.local` next

### 3. Install

```bash
npm install
```

### 4. Configure your API key

```bash
cp .env.example .env.local
```

Edit `.env.local` and set (no quotes, no trailing spaces):

```
GROQ_API_KEY=gsk_your-real-key-here
```

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000

### 6. Production build

```bash
npm run build
npm start
```

## Notes & limits

- Default max upload size per file is 500MB and per-batch limit is 30 files
  (configurable in `pages/api/analyze.js`).
- Large batches of long reels will take a few minutes — frame extraction +
  30 sequential Claude calls + 1 ranking call. For production use at scale,
  consider:
  - Processing reels in parallel (with concurrency limits) instead of sequentially
  - Adding a job queue (e.g. BullMQ) + polling/websocket progress updates
  - Persisting results to a database instead of returning everything in one response
- This app processes video files server-side and deletes temp files after
  each analysis run (see `finally` block in `pages/api/analyze.js`).
- Vercel's serverless functions have execution time/payload limits that may
  not suit large batches — for heavy production use, deploy the API route on
  a long-running Node server (e.g. a VPS, Render, Railway, Fly.io) rather than
  default serverless hosting.

## Project structure

```
reel-analyser-ai/
├── pages/
│   ├── index.js          # Upload + results UI
│   ├── _app.js
│   └── api/
│       └── analyze.js    # Main API route: upload, ffmpeg, Claude calls, ranking
├── lib/
│   ├── ffmpegUtils.js    # Frame/metadata/audio extraction
│   └── groqAnalyzer.js   # Groq prompts + API calls (per-reel + batch ranking)
├── styles/
│   └── globals.css
├── package.json
├── next.config.js
└── .env.example
```
