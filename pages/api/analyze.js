import formidable from "formidable";
import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { extractFrames, extractAudio } from "../../lib/ffmpegUtils";
import { analyzeReel, rankBatch } from "../../lib/groqAnalyzer";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILES = 30;
// Llama 4 Scout (Groq) accepts a maximum of 5 images per request — keep this in sync
// with MAX_IMAGES_PER_REQUEST in lib/groqAnalyzer.js if you change providers/models.
const FRAMES_PER_REEL = 5;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error:
        "Missing GROQ_API_KEY. Set it in your .env.local file (see .env.example).",
    });
  }

  const tmpRoot = path.join(os.tmpdir(), "reel-analyser-" + uuidv4());
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const form = formidable({
      multiples: true,
      uploadDir: tmpRoot,
      keepExtensions: true,
      maxFiles: MAX_FILES,
      maxFileSize: 500 * 1024 * 1024, // 500MB per file
    });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    let uploaded = files.reels;
    if (!uploaded) {
      return res.status(400).json({ error: "No files uploaded under field 'reels'." });
    }
    if (!Array.isArray(uploaded)) uploaded = [uploaded];
    if (uploaded.length > MAX_FILES) {
      return res
        .status(400)
        .json({ error: `Max ${MAX_FILES} reels per batch. Received ${uploaded.length}.` });
    }

    const results = [];

    for (const file of uploaded) {
      const fileName = file.originalFilename || file.newFilename;
      const filePath = file.filepath;
      const reelDir = path.join(tmpRoot, path.parse(filePath).name);

      try {
        const { frames, meta } = await extractFrames(filePath, reelDir, FRAMES_PER_REEL);
        // Audio extraction currently informs metadata only (codec/bitrate already in meta);
        // kept here for future deeper audio analysis (tempo/loudness) without breaking the API shape.
        await extractAudio(filePath, reelDir);

        const analysis = await analyzeReel({ frames, meta, fileName });

        results.push({ fileName, meta, analysis });
      } catch (innerErr) {
        results.push({
          fileName,
          error: innerErr.message || "Failed to process this reel",
        });
      }
    }

    const validResults = results.filter((r) => !r.error);
    let ranking = [];
    if (validResults.length > 0) {
      ranking = await rankBatch(validResults);
    }

    // Merge rank info back in
    const merged = results.map((r) => {
      const rankInfo = ranking.find((rk) => rk.fileName === r.fileName);
      return { ...r, rank: rankInfo?.rank || null, verdict: rankInfo?.verdict || null };
    });

    merged.sort((a, b) => {
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });

    res.status(200).json({ results: merged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  } finally {
    fs.rm(tmpRoot, { recursive: true, force: true }, () => {});
  }
}
