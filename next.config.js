/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  serverExternalPackages: [
    "fluent-ffmpeg",
    "ffmpeg-static",
    "ffprobe-static",
  ],
};

module.exports = nextConfig;