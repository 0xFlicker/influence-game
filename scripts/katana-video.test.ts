import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Run the real CLI with a fetch preload: no provider, credentials, or existing artifacts.
async function run(command: string, failure = "") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "katana-fields-"));
  const preload = path.join(directory, "mock.ts");
  const files = ["07-arden-voss.jpg", "09-mara-voss.jpg", "coastal-room-background.png",
    "arden-scene-keyframe.png", "mara-scene-keyframe.png", "arden-shot-keyframe.png",
    "mara-shot-keyframe.png", "arden-ots-keyframe.png", "mara-ots-keyframe.png"];
  try {
    for (const file of files) await writeFile(path.join(directory, file), file);
    await writeFile(preload, `
      globalThis.fetch = async (url, init) => {
        if (!String(url).endsWith('/v1/generation-requests?wait=false') || init.method !== 'POST') throw new Error('Unexpected network call');
        const body = JSON.parse(init.body);
        const file = Bun.file(${JSON.stringify(path.join(directory, "calls.json"))});
        const calls = await file.exists() ? await file.json() : [];
        await Bun.write(file, JSON.stringify([...calls, body]));
        const requests = structuredClone(body.requests).reverse();
        for (const item of requests) {
          if (${JSON.stringify(failure)} === 'missing') { item.video_image_data = {}; item.image_urls = []; }
          if (${JSON.stringify(failure)} === 'partial' && item.video_image_data?.reference_image_urls) item.video_image_data.reference_image_urls.pop();
          if (${JSON.stringify(failure)} === 'blank' && item.video_image_data?.reference_image_urls) item.video_image_data.reference_image_urls[0] = '';
        }
        return Response.json({request_id: 'saved-request-id', status: 'pending', requests: ${JSON.stringify(failure)} === 'no-items' ? [] : requests});
      };
    `);
    const child = Bun.spawn([process.execPath, "--preload", preload,
      path.resolve("packages/made-for-video/src/katana-video.ts"), ...command.split(" ")], {
      env: { ...process.env, API_KAT_IMGNAI_KEY: "fake", API_KAT_IMGNAI_SECRET: "fake",
        MADE_FOR_VIDEO_OUTPUT_DIRECTORY: directory, MADE_FOR_VIDEO_AVATAR_DIRECTORY: directory },
      stdout: "pipe", stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    const calls = await Bun.file(path.join(directory, "calls.json")).json();
    const receipts = await Promise.all((await readdir(directory)).filter((name) => name.startsWith("receipt-")).map((name) => Bun.file(path.join(directory, name)).json()));
    return { exit, stderr, calls, receipts };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [command, kind, count] of [
  ["submit", "reference", 2], ["submit-reference-only", "reference", 1],
  ["submit-angles", "frame", 1], ["submit-composite-anchors", "frame", 1],
  ["submit-image-composed-video-angles", "frame", 1], ["submit-ots-video-angles", "frame", 1],
  ["retry-ots-video-angle arden-ots-anchor", "frame", 1],
  ["submit-image-composed-keyframe", "image", 2],
  ["submit-image-composed-shot-keyframes", "image", 2], ["submit-ots-keyframes", "image", 3],
] as const) {
  test(`actual ${command} builder retains ${kind} conditioning`, async () => {
    const result = await run(command);
    expect(result.stderr).toBe("");
    expect(result.exit).toBe(0);
    expect(result.calls).toHaveLength(1);
    for (const item of result.calls[0].requests) {
      expect(item).not.toHaveProperty("input_images");
      expect(item).not.toHaveProperty("input_image");
      const decode = (value: string) => Buffer.from(value.split(",")[1]!, "base64").toString();
      const avatar = item.id.startsWith("mara") ? "09-mara-voss.jpg" : "07-arden-voss.jpg";
      if (kind === "image") {
        expect(item.image_urls).toHaveLength(count);
        expect(decode(item.image_urls[0])).toBe(avatar);
        expect(decode(item.image_urls.at(-1))).toBe("coastal-room-background.png");
        if (count === 3) expect(decode(item.image_urls[1])).toBe(avatar === "07-arden-voss.jpg" ? "09-mara-voss.jpg" : "07-arden-voss.jpg");
        expect(item).not.toHaveProperty("video_image_data");
      } else {
        expect(item.model).toBe("imgn-h3");
        expect(item).not.toHaveProperty("image_urls");
        if (kind === "reference") {
          expect(Object.keys(item.video_image_data)).toEqual(["reference_image_urls"]);
          expect(item.video_image_data.reference_image_urls.map(decode)).toEqual(
            count === 2 ? ["07-arden-voss.jpg", "09-mara-voss.jpg"] : ["07-arden-voss.jpg"],
          );
        } else {
          expect(Object.keys(item.video_image_data)).toEqual(["first_frame_image_url"]);
          const name = item.id.startsWith("mara") ? "mara" : "arden";
          const frame = command === "submit-angles" ? avatar
            : command === "submit-composite-anchors" ? `${name}-scene-keyframe.png`
            : command === "submit-image-composed-video-angles" ? `${name}-shot-keyframe.png`
            : `${name}-ots-keyframe.png`;
          expect(decode(item.video_image_data.first_frame_image_url)).toBe(frame);
        }
      }
    }
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0].submitted).toEqual(result.calls[0]);
    expect(result.receipts[0].result.request_id).toBe("saved-request-id");
  });
}

for (const [command, failure] of [
  ["submit", "missing"], ["submit", "partial"], ["submit", "blank"], ["submit", "no-items"],
  ["submit-image-composed-keyframe", "missing"], ["submit-angles", "missing"],
]) {
  test(`${command} fails on ${failure} conditioning without resubmission`, async () => {
    const result = await run(command!, failure);
    expect(result.exit).not.toBe(0);
    expect(result.stderr).toContain("missing conditioning");
    expect(result.stderr).toContain("saved-request-id");
    expect(result.stderr).toContain("Do not resubmit");
    expect(result.calls).toHaveLength(1);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0].result.request_id).toBe("saved-request-id");
  });
}
