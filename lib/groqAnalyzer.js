const Groq = require("groq-sdk");
const fs = require("fs");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Groq's free tier is available globally (no region restriction like Gemini's free tier).
// Model availability on Groq rotates/deprecates frequently — these are the current
// (as of mid-2026) supported models. If you get a "model_decommissioned" error,
// check https://console.groq.com/docs/vision and https://console.groq.com/docs/models
// for the current model IDs and swap them in below.
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // supports up to 5 images/request
const RANKING_MODEL = "openai/gpt-oss-20b"; // fast text-only model for the ranking pass

// Llama 4 Scout accepts a maximum of 5 images per request, so frame extraction
// is capped here to match (see FRAMES_PER_REEL in pages/api/analyze.js).
const MAX_IMAGES_PER_REQUEST = 5;

function frameToDataUrl(framePath) {
  const data = fs.readFileSync(framePath).toString("base64");
  return `data:image/jpeg;base64,${data}`;
}

const SYSTEM_PROMPT = `You are an expert short-form video (Instagram/YouTube Reels, TikTok) editor and analyst.
You will be shown a sequence of frames sampled evenly across one reel, plus basic technical metadata
(duration, resolution, fps, whether it has audio, audio bitrate/codec).

Score the reel on these categories, each from 0-10 (10 = excellent, professional quality):
- editing: cut rhythm/pacing implied by visual variety across frames, framing changes, transitions, visual storytelling structure
- lighting: exposure, contrast, color grading, use of natural/artificial light, shadows, white balance
- framing: composition, rule of thirds, subject placement, headroom, stability cues, camera angle choices ("taking"/shot quality)
- music_audio: based ONLY on available audio metadata (presence, bitrate, codec) and any visual cues of sync (e.g. motion suggesting beat-matched cuts) — be honest that this is a rough proxy since you cannot literally hear the audio
- hook_engagement: how compelling the opening frame(s) look for stopping a scroll, and overall visual interest

For each category also give a one-sentence reason.

Then give an "overall" score (0-10, weighted: editing 30%, framing 25%, lighting 20%, music_audio 10%, hook_engagement 15%)
and 2-3 concrete, actionable improvement tips.

Respond ONLY with strict JSON, no markdown fences, no preamble, in exactly this shape:
{
  "editing": {"score": 0, "reason": ""},
  "lighting": {"score": 0, "reason": ""},
  "framing": {"score": 0, "reason": ""},
  "music_audio": {"score": 0, "reason": ""},
  "hook_engagement": {"score": 0, "reason": ""},
  "overall": 0,
  "tips": ["", ""],
  "summary": ""
}`;

function extractJson(rawText) {
  let raw = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    raw = raw.slice(start, end + 1);
  }
  return JSON.parse(raw);
}

async function analyzeReel({ frames, meta, fileName }) {
  const usedFrames = frames.slice(0, MAX_IMAGES_PER_REQUEST);

  const metaText = `Reel filename: ${fileName}
Duration: ${meta.duration?.toFixed(2)}s
Resolution: ${meta.width}x${meta.height}
FPS: ${meta.fps}
Has audio track: ${meta.hasAudio}
Audio codec: ${meta.audioCodec || "n/a"}
Audio bitrate: ${meta.audioBitrate || "n/a"}

The ${usedFrames.length} frames below are sampled evenly across the reel's timeline, in order
(first image = start, last image = near the end).`;

  const content = [
    { type: "text", text: metaText },
    ...usedFrames.map((framePath) => ({
      type: "image_url",
      image_url: { url: frameToDataUrl(framePath) },
    })),
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      max_completion_tokens: 1000,
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content || "{}";
    return extractJson(text);
  } catch (e) {
    return {
      editing: { score: 0, reason: "AI error" },
      lighting: { score: 0, reason: "AI error" },
      framing: { score: 0, reason: "AI error" },
      music_audio: { score: 0, reason: "AI error" },
      hook_engagement: { score: 0, reason: "AI error" },
      overall: 0,
      tips: [],
      summary: "Groq request/parse failed: " + (e.message || "unknown error"),
    };
  }
}

/**
 * After all reels are individually scored, ask the model to do a final
 * comparative ranking pass across the whole batch for a more consistent ordering.
 */
async function rankBatch(reelResults) {
  const compact = reelResults.map((r) => ({
    fileName: r.fileName,
    overall: r.analysis.overall,
    editing: r.analysis.editing.score,
    lighting: r.analysis.lighting.score,
    framing: r.analysis.framing.score,
    music_audio: r.analysis.music_audio.score,
    hook_engagement: r.analysis.hook_engagement.score,
  }));

  try {
    const completion = await groq.chat.completions.create({
      model: RANKING_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are ranking a batch of already-scored short video reels for overall quality. " +
            "Given the per-category scores (0-10) for each reel, produce a final ranked order " +
            "(best first) and a one-line verdict per reel. Respond ONLY with strict JSON: " +
            '{"ranking": [{"fileName": "", "rank": 1, "verdict": ""}]}',
        },
        { role: "user", content: JSON.stringify(compact) },
      ],
      max_completion_tokens: 800,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content || "{}";
    return extractJson(text).ranking;
  } catch (e) {
    // Fallback: rank purely by overall score if the ranking pass fails
    return [...reelResults]
      .sort((a, b) => b.analysis.overall - a.analysis.overall)
      .map((r, i) => ({
        fileName: r.fileName,
        rank: i + 1,
        verdict: "Ranked by overall score (fallback).",
      }));
  }
}

module.exports = { analyzeReel, rankBatch };

