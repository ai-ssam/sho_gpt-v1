import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildFrameTargets } from "../dist/core.mjs";

const manifest = JSON.parse(await readFile(new URL("./sample-video-manifest.json", import.meta.url), "utf8"));
assert.deepEqual(manifest.map(item => item.motion).sort(), ["AB", "BIR", "CIR", "ER", "FE"]);

for (const sample of manifest) {
  const targets = buildFrameTargets(sample.duration, sample.fps, 1);
  assert.equal(targets.length, sample.frames, `${sample.motion} 전체 프레임 수`);
  assert.equal(targets[0].sourceFrame, 0, `${sample.motion} 첫 프레임`);
  assert.equal(targets.at(-1).sourceFrame, sample.frames - 1, `${sample.motion} 마지막 프레임`);
}

const sampleDirectory = process.env.SHOULDER_SAMPLE_VIDEO_DIR;
if (sampleDirectory) {
  for (const sample of manifest) {
    const result = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", join(sampleDirectory, sample.file)
    ], { encoding: "utf8" }));
    const stream = result.streams?.[0];
    assert.equal(Number(stream?.width), sample.width, `${sample.motion} 실제 영상 너비`);
    assert.equal(Number(stream?.height), sample.height, `${sample.motion} 실제 영상 높이`);
    assert.equal(Number(stream?.nb_read_frames), sample.frames, `${sample.motion} 실제 디코딩 프레임 수`);
  }
}

console.log(`sample video tests: ${manifest.length} motions / ${manifest.reduce((sum, item) => sum + item.frames, 0)} frames passed${sampleDirectory ? " (decoded)" : ""}`);
