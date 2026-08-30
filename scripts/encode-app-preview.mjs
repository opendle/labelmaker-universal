import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const PREVIEW_SECONDS = 20;

export async function encodeAppPreview({
  sourcePath,
  outputPath,
  width,
  height,
}) {
  await mkdir(dirname(outputPath), { recursive: true });
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex",
    `[0:v]fps=30,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},tpad=stop_mode=clone:stop_duration=${PREVIEW_SECONDS},format=yuv420p[video]`,
    "-map",
    "[video]",
    "-map",
    "1:a",
    "-t",
    String(PREVIEW_SECONDS),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-tag:v",
    "avc1",
    "-b:v",
    "11M",
    "-minrate",
    "11M",
    "-maxrate",
    "11M",
    "-bufsize",
    "22M",
    "-x264-params",
    "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  const probe = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration,bit_rate,size:stream=codec_name,profile,level,width,height,pix_fmt,field_order,avg_frame_rate,channels,sample_rate",
      "-of",
      "json",
      outputPath,
    ]),
  );
  const video = probe.streams?.find((stream) => stream.codec_name === "h264");
  const audio = probe.streams?.find((stream) => stream.codec_name === "aac");
  const duration = Number(probe.format?.duration);
  const bitRate = Number(probe.format?.bit_rate);
  const fileSize = Number(probe.format?.size);
  const frameRate = readFrameRate(video?.avg_frame_rate);
  if (
    video?.width !== width ||
    video.height !== height ||
    video.profile !== "High" ||
    typeof video.level !== "number" ||
    video.level > 40 ||
    video.pix_fmt !== "yuv420p" ||
    video.field_order !== "progressive" ||
    !audio ||
    audio.channels !== 2 ||
    (audio.sample_rate !== "44100" && audio.sample_rate !== "48000") ||
    !Number.isFinite(duration) ||
    duration < 15 ||
    duration > 30 ||
    frameRate > 30 ||
    !Number.isFinite(bitRate) ||
    bitRate < 10_000_000 ||
    bitRate > 12_000_000 ||
    !Number.isFinite(fileSize) ||
    fileSize > 500_000_000
  ) {
    throw new Error(
      `The encoded preview does not meet Apple requirements: ${JSON.stringify(probe)}.`,
    );
  }
}

function readFrameRate(value) {
  if (typeof value !== "string") return Number.POSITIVE_INFINITY;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : Number.POSITIVE_INFINITY;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `${command} is required to create App Store previews. Install FFmpeg and try again.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
}
