const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Get basic metadata about a video: duration, fps, resolution, has audio.
 */
function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      const audioStream = data.streams.find((s) => s.codec_type === "audio");
      resolve({
        duration: data.format.duration || 0,
        width: videoStream?.width || null,
        height: videoStream?.height || null,
        fps: videoStream?.avg_frame_rate
          ? eval(videoStream.avg_frame_rate) // "30/1" -> 30
          : null,
        hasAudio: !!audioStream,
        audioBitrate: audioStream?.bit_rate || null,
        audioCodec: audioStream?.codec_name || null,
      });
    });
  });
}

/**
 * Extracts `count` evenly spaced JPEG frames from a video into outDir.
 * Returns an array of absolute file paths.
 */
function extractFrames(filePath, outDir, count = 6) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    getVideoMetadata(filePath)
      .then((meta) => {
        const duration = meta.duration || 10;
        // Evenly spaced timestamps, avoiding the very first/last 0.2s
        const margin = Math.min(0.3, duration * 0.05);
        const usableDuration = Math.max(duration - margin * 2, 0.5);
        const timestamps = Array.from({ length: count }, (_, i) =>
          (margin + (usableDuration * i) / Math.max(count - 1, 1)).toFixed(2)
        );

        // fluent-ffmpeg's screenshots() numbers output files starting at 1, not 0
        // (frame_1.jpg, frame_2.jpg, ...), so build the expected paths to match.
        const outputFiles = timestamps.map((t, i) =>
          path.join(outDir, `frame_${i + 1}.jpg`)
        );

        ffmpeg(filePath)
          .on("end", () => {
            const missing = outputFiles.filter((f) => !fs.existsSync(f));
            if (missing.length > 0) {
              return reject(
                new Error(
                  `ffmpeg reported success but ${missing.length} frame(s) are missing: ${missing.join(", ")}`
                )
              );
            }
            resolve({ frames: outputFiles, meta });
          })
          .on("error", (err) => reject(err))
          .screenshots({
            timestamps,
            filename: "frame_%i.jpg",
            folder: outDir,
            size: "480x?",
          });
      })
      .catch(reject);
  });
}

/**
 * Extracts the audio track as a low-bitrate mp3 for basic tempo/loudness analysis.
 */
function extractAudio(filePath, outDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "audio.mp3");
    ffmpeg(filePath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .on("end", () => resolve(outPath))
      .on("error", (err) => {
        // Some reels may have no audio stream at all
        resolve(null);
      })
      .save(outPath);
  });
}

module.exports = { extractFrames, extractAudio, getVideoMetadata };
