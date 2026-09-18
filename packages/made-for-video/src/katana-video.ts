import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://kat.imgnai.com";
const OUTPUT_DIRECTORY = process.env.MADE_FOR_VIDEO_OUTPUT_DIRECTORY?.trim()
  || "/private/tmp/sharp-tan-reef-producer-capture/katana-proof";
const AVATAR_DIRECTORY = process.env.MADE_FOR_VIDEO_AVATAR_DIRECTORY?.trim()
  || "/private/tmp/sharp-tan-reef-producer-capture/avatars";
const MODEL = "imgnh3";
const CLIENT_REQUEST_ID = "sharp-tan-reef-arden-mara-h3-proof-v1";

const scene = {
  prompt: [
    "A grounded, cinematic five-second social-strategy-game reenactment in a quiet private strategy room at night.",
    "@Image1 is Arden Voss and @Image2 is Mara Voss; preserve each person's identity, face, hair, and wardrobe from their reference portrait.",
    "A glass-walled lounge above a storm-dark coast, a muted blue tactical map glowing on the table, warm practical lamps, no other people.",
    "Start with Arden, seated at the table, calmly but urgently redirecting attention from themself toward the map; then Mara studies Arden, looks to the map, and gives a measured, reluctant nod.",
    "The emotional beat is a strategic redirection, not a shouting match. Natural restrained hand gestures, credible eye lines, slow push-in camera, polished prestige-reality-drama realism.",
    "Performance intent: Arden says, ‘Pointing at me only tests someone who already backed Vesper.’ Mara replies, ‘Vesper makes more sense as the pressure point.’",
    "Use quiet natural English speech if dialogue is generated; otherwise use only room tone. No subtitles or on-screen text.",
  ].join(" "),
  negativePrompt: [
    "text, captions, subtitles, logos, watermarks, extra people, duplicate characters, face swapping, changing identities,",
    "talking to camera, exaggerated acting, shouting, violence, weapon, political campaign, low resolution, flicker",
  ].join(", "),
};

const singleAvatarAngles = [
  {
    id: "arden-close",
    avatar: "07-arden-voss.jpg",
    filename: "arden-close.mp4",
    prompt: [
      "A cinematic ten-second close three-quarter shot in the same quiet, glass-walled coastal strategy room at night.",
      "The person in the supplied first-frame portrait is Arden Voss. Preserve Arden's exact identity, face shape, brown swept hair, brown eyes, and dark jacket throughout; no identity drift or face change.",
      "Arden is seated at the glowing blue tactical map table, looking toward an off-screen conversation partner. Warm practical lamps and a storm-dark ocean are visible behind them.",
      "One controlled, persuasive turn: Arden gestures once toward the map, then holds a calm, strategic eye line. Medium-close 50mm lens, gentle push-in, prestige reality-drama naturalism.",
      "Arden says exactly in clear natural English: ‘I understand wanting a clean test, but pointing at me mostly gives the room information about a person who already empowered Vesper openly. I’d rather make the first pressure point Vesper.’",
      "No subtitles or on-screen text; no other person appears in frame.",
    ].join(" "),
  },
  {
    id: "mara-reverse",
    avatar: "09-mara-voss.jpg",
    filename: "mara-reverse.mp4",
    prompt: [
      "A cinematic ten-second matched reverse angle in the same quiet, glass-walled coastal strategy room at night.",
      "The person in the supplied first-frame portrait is Mara Voss. Preserve Mara's exact identity, dark wavy hair, brown eyes, and dark jacket throughout; no identity drift or face change.",
      "Mara is seated at the glowing blue tactical map table, looking toward an off-screen Arden. Warm practical lamps and a storm-dark ocean are visible behind her.",
      "Mara considers the map, makes one small measured nod, then speaks with deliberate certainty. Medium-close 50mm lens, gentle push-in, same lighting and prestige reality-drama naturalism as the prior shot.",
      "Mara says exactly in clear natural English: ‘Yes, Vesper makes more sense as the first pressure point than Arden: four empower votes plus the chooser role means her pointer can tell us much more.’",
      "No subtitles or on-screen text; no other person appears in frame.",
    ].join(" "),
  },
] as const;

const angleNegativePrompt = [
  "text, captions, subtitles, logos, watermarks, other people, duplicate characters, face swapping, changing identities,",
  "talking to camera, exaggerated acting, shouting, violence, weapon, political campaign, low resolution, flicker",
].join(", ");

const referenceOnly = {
  id: "arden-reference-only",
  prompt: [
    "A cinematic five-second medium close-up of Arden Voss already seated in a quiet glass-walled coastal strategy room at night.",
    "Use the supplied image only as a character-identity reference, not as an opening frame: begin immediately inside the room, with no portrait card, freeze-frame, image transition, or gray studio background.",
    "Preserve Arden's recognizable face, swept brown hair, brown eyes, and dark jacket from the reference while placing them naturally at a glowing blue tactical map table.",
    "Arden looks toward an off-screen conversation partner, makes one restrained gesture toward the map, then holds a thoughtful strategic expression. Warm practical lamps, storm-dark ocean beyond the glass, 50mm camera, realistic prestige-drama lighting.",
    "Room tone only. No speech, subtitles, on-screen text, or other people.",
  ].join(" "),
};

const backgroundPlate = {
  prompt: [
    "An empty cinematic glass-walled coastal strategy room at night, medium-wide 16:9 shot from table height.",
    "A large dark wood conference table with an unlit glass surface in the foreground, warm practical lamps, storm-dark ocean beyond rain-streaked windows, restrained blue ambient light, prestige reality-drama realism.",
    "No people, no silhouettes, no chairs facing camera, no screens, no text, no logos, no markings or maps.",
  ].join(" "),
};

const compositeAnchoredAngles = [
  {
    id: "arden-composite-anchor",
    keyframe: "arden-scene-keyframe.png",
    filename: "arden-composite-anchor.mp4",
    prompt: [
      "Continue the supplied in-world scene keyframe seamlessly for ten seconds. Do not begin with a portrait card, image transition, or studio background.",
      "Preserve Arden Voss exactly as shown in the supplied frame: same recognizable face, swept brown hair, brown eyes, dark jacket, room geometry, table position, and lighting.",
      "Arden makes one calm persuasive gesture toward the table, then holds an intent eye line toward an off-screen Mara. Slow, subtle camera push-in; no new person enters frame.",
      "Arden says exactly in clear natural English: ‘I understand wanting a clean test, but pointing at me mostly gives the room information about a person who already empowered Vesper openly. I’d rather make the first pressure point Vesper.’",
      "No subtitles or on-screen text.",
    ].join(" "),
  },
  {
    id: "mara-composite-anchor",
    keyframe: "mara-scene-keyframe.png",
    filename: "mara-composite-anchor.mp4",
    prompt: [
      "Continue the supplied in-world scene keyframe seamlessly for ten seconds. Do not begin with a portrait card, image transition, or studio background.",
      "Preserve Mara Voss exactly as shown in the supplied frame: same recognizable face, dark wavy hair, brown eyes, dark jacket, room geometry, table position, and lighting.",
      "Mara considers the table, makes one small measured nod, then holds a deliberate eye line toward an off-screen Arden. Slow, subtle camera push-in; no new person enters frame.",
      "Mara says exactly in clear natural English: ‘Yes, Vesper makes more sense as the first pressure point than Arden: four empower votes plus the chooser role means her pointer can tell us much more.’",
      "No subtitles or on-screen text.",
    ].join(" "),
  },
] as const;

const imageComposedKeyframe = {
  prompt: [
    "Create one seamless cinematic 16:9 scene image using @Image1 as the exact character-identity reference and @Image2 as the exact room/background reference.",
    "Place the @Image1 person naturally seated behind the near end of the conference table in @Image2, chest-up, with their lower body convincingly hidden by the table. Preserve their recognizable face, hair, eyes, and dark jacket.",
    "Match the room's rainy coastal night lighting, camera height, lens perspective, table geometry, and warm practical lamps. The person looks toward an off-screen conversation partner with calm strategic focus.",
    "This is an in-world starting frame, not a portrait card or a collage. No other people, text, screens, maps, logos, watermarks, or visible compositing edges.",
  ].join(" "),
};

const imageComposedShotKeyframes = [
  {
    id: "arden-shot-keyframe",
    avatar: "07-arden-voss.jpg",
    filename: "arden-shot-keyframe.png",
    prompt: [
      "Create one seamless cinematic 16:9 medium-close scene image using @Image1 as the exact character-identity reference and @Image2 as the exact room/background reference.",
      "Place the @Image1 person naturally seated behind the far end of the conference table in @Image2, framed chest-up and occupying the right third of the image. Preserve their recognizable face, swept brown hair, brown eyes, and dark jacket.",
      "Match the room's rainy coastal night lighting, camera height, lens perspective, table geometry, and warm practical lamps. The person looks left toward an off-screen conversation partner with calm strategic focus.",
      "This is an in-world starting frame, not a portrait card or collage. No other people, text, screens, maps, logos, watermarks, or visible compositing edges.",
    ].join(" "),
  },
  {
    id: "mara-shot-keyframe",
    avatar: "09-mara-voss.jpg",
    filename: "mara-shot-keyframe.png",
    prompt: [
      "Create one seamless cinematic 16:9 medium-close reverse-angle scene image using @Image1 as the exact character-identity reference and @Image2 as the exact room/background reference.",
      "Place the @Image1 person naturally seated behind the far end of the conference table in @Image2, framed chest-up and occupying the left third of the image. Preserve their recognizable face, dark wavy hair, brown eyes, and dark jacket.",
      "Match the room's rainy coastal night lighting, camera height, lens perspective, table geometry, and warm practical lamps. The person looks right toward an off-screen conversation partner with calm strategic focus.",
      "This is an in-world starting frame, not a portrait card or collage. No other people, text, screens, maps, logos, watermarks, or visible compositing edges.",
    ].join(" "),
  },
] as const;

const imageComposedVideoAngles = [
  {
    id: "arden-image-composed-anchor",
    keyframe: "arden-shot-keyframe.png",
    filename: "arden-image-composed-anchor.mp4",
    prompt: [
      "Continue the supplied in-world shot keyframe seamlessly for ten seconds. Do not begin with a portrait card, image transition, or studio background.",
      "Preserve Arden Voss exactly as shown in the supplied frame: same recognizable face, swept brown hair, brown eyes, dark jacket, seated position, room geometry, table position, and lighting.",
      "Arden makes one calm persuasive gesture toward the table, then holds an intent eye line toward an off-screen Mara. Slow, subtle camera push-in; no new person enters frame.",
      "Arden says exactly in clear natural English: ‘I understand wanting a clean test, but pointing at me mostly gives the room information about a person who already empowered Vesper openly. I’d rather make the first pressure point Vesper.’",
      "No subtitles or on-screen text.",
    ].join(" "),
  },
  {
    id: "mara-image-composed-anchor",
    keyframe: "mara-shot-keyframe.png",
    filename: "mara-image-composed-anchor.mp4",
    prompt: [
      "Continue the supplied in-world shot keyframe seamlessly for ten seconds. Do not begin with a portrait card, image transition, or studio background.",
      "Preserve Mara Voss exactly as shown in the supplied frame: same recognizable face, dark wavy hair, brown eyes, dark jacket, seated position, room geometry, table position, and lighting.",
      "Mara considers the table, makes one small measured nod, then holds a deliberate eye line toward an off-screen Arden. Slow, subtle camera push-in; no new person enters frame.",
      "Mara says exactly in clear natural English: ‘Yes, Vesper makes more sense as the first pressure point than Arden: four empower votes plus the chooser role means her pointer can tell us much more.’",
      "No subtitles or on-screen text.",
    ].join(" "),
  },
] as const;

const overTheShoulderKeyframes = [
  {
    id: "arden-ots-keyframe",
    filename: "arden-ots-keyframe.png",
    prompt: [
      "Create one seamless cinematic 16:9 over-the-shoulder conversation shot using @Image1 as the exact identity reference for Arden Voss, @Image2 as the exact identity reference for Mara Voss, and @Image3 as the exact room/background reference.",
      "Camera is immediately behind and slightly left of seated Mara Voss: Mara's dark wavy hair, shoulder, and the back of her dark jacket appear softly out of focus in the near left foreground. Across the table, Arden Voss is the sharply focused speaking subject, chest-up on the right half of frame, naturally looking directly at Mara rather than at camera.",
      "Preserve both people’s recognizable faces, hair, eyes, and dark wardrobes from their respective reference portraits. The room is a rainy coastal strategy room at night: match @Image3's table geometry, camera height, warm practical lamps, and storm-dark ocean windows. No empty-table solo composition.",
      "Performance moment: Arden is gently but urgently pleading a case while concealing a survival-minded calculation. A small held breath, attentive eyes, restrained open-palmed gesture toward Mara and the table; no tears, melodrama, anger, or direct-to-camera appeal. Arden is trying to redirect a dangerous focus without burning the relationship.",
      "This is a lived-in, in-world opening frame for a shot/reverse-shot scene, not a portrait card or collage. No text, screens, maps, logos, watermarks, extra people, visible compositing seams, or music notation.",
    ].join(" "),
  },
  {
    id: "mara-ots-keyframe",
    filename: "mara-ots-keyframe.png",
    prompt: [
      "Create one seamless cinematic 16:9 reverse over-the-shoulder conversation shot using @Image1 as the exact identity reference for Mara Voss, @Image2 as the exact identity reference for Arden Voss, and @Image3 as the exact room/background reference.",
      "Camera is immediately behind and slightly right of seated Arden Voss: Arden's swept brown hair, shoulder, and the back of his dark jacket appear softly out of focus in the near right foreground. Across the table, Mara Voss is the sharply focused listening-and-answering subject, chest-up on the left half of frame, naturally looking directly at Arden rather than at camera.",
      "Preserve both people’s recognizable faces, hair, eyes, and dark wardrobes from their respective reference portraits. The room is the same rainy coastal strategy room at night: match @Image3's table geometry, camera height, warm practical lamps, and storm-dark ocean windows. No empty-table solo composition.",
      "Performance moment: Mara is businesslike and calculating—she measures Arden's proposal, briefly weighs the legal and strategic caveat, then arrives at controlled agreement. Still posture, observant gaze, a restrained analytical nod; no smile, melodrama, anger, or direct-to-camera delivery.",
      "This is a lived-in, in-world opening frame for a matching shot/reverse-shot scene, not a portrait card or collage. No text, screens, maps, logos, watermarks, extra people, visible compositing seams, or music notation.",
    ].join(" "),
  },
] as const;

const overTheShoulderVideoAngles = [
  {
    id: "arden-ots-anchor",
    keyframe: "arden-ots-keyframe.png",
    filename: "arden-ots-anchor.mp4",
    prompt: [
      "Continue the supplied in-world over-the-shoulder keyframe seamlessly for ten seconds. Do not begin with a portrait card, image transition, studio background, or change in camera side.",
      "Preserve Arden Voss and the blurred foreground Mara Voss exactly as shown: their recognizable identities, wardrobes, seated positions, eye line to one another, table geometry, room lighting, and the rainy coastal night world. Arden remains the focused speaker; Mara remains a quiet foreground listener.",
      "Arden speaks with restrained pleading urgency under a carefully controlled strategic exterior: a subtle breath, one open-palmed appeal toward Mara, then a contained recalibration after naming Vesper. No overt distress, tears, shouting, direct-to-camera acting, or broad gesturing.",
      "Generate Arden's spoken dialogue in clear, natural English: ‘I understand wanting a clean test, but pointing at me mostly gives the room information about a person who already empowered Vesper openly. I’d rather make the first pressure point Vesper.’",
      "Use natural diegetic sound only: rain against the windows, soft fabric movement, a subtle chair creak, and quiet room ambience. Absolutely no background music, score, musical sting, singing, subtitles, captions, or on-screen text.",
    ].join(" "),
  },
  {
    id: "mara-ots-anchor",
    keyframe: "mara-ots-keyframe.png",
    filename: "mara-ots-anchor.mp4",
    prompt: [
      "Continue the supplied in-world reverse over-the-shoulder keyframe seamlessly for ten seconds. Do not begin with a portrait card, image transition, studio background, or change in camera side.",
      "Preserve Mara Voss and the blurred foreground Arden Voss exactly as shown: their recognizable identities, wardrobes, seated positions, eye line to one another, table geometry, room lighting, and the rainy coastal night world. Mara remains the focused speaker; Arden remains a quiet foreground listener.",
      "Mara speaks with businesslike, calculating control: she takes a short analytical beat, watches Arden, gives one minimal considered nod, and commits only to the strategically useful part of the proposal. No smile, overt emotion, shouting, direct-to-camera acting, or broad gesturing.",
      "Generate Mara's spoken dialogue in clear, natural English: ‘Yes, Vesper makes more sense as the first pressure point than Arden: four empower votes plus the chooser role means her pointer can tell us much more.’",
      "Use natural diegetic sound only: rain against the windows, soft fabric movement, a subtle chair creak, and quiet room ambience. Absolutely no background music, score, musical sting, singing, subtitles, captions, or on-screen text.",
    ].join(" "),
  },
] as const;

function credentials(): { key: string; secret: string } {
  const key = process.env.API_KAT_IMGNAI_KEY?.trim();
  const secret = process.env.API_KAT_IMGNAI_SECRET?.trim();
  if (!key || !secret) throw new Error("API_KAT_IMGNAI_KEY and API_KAT_IMGNAI_SECRET are required.");
  return { key, secret };
}

async function katanaFetch(endpoint: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const { key, secret } = credentials();
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
      "X-API-Secret": secret,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) throw new Error(`Katana HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function dataUrl(filename: string): Promise<string> {
  return dataUrlAt(path.join(AVATAR_DIRECTORY, filename), "image/jpeg");
}

async function dataUrlAt(filePath: string, mimeType: string): Promise<string> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) throw new Error(`Missing image input: ${filePath}`);
  return `data:${mimeType};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

async function submit(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: CLIENT_REQUEST_ID,
    requests: [{
      id: "arden-mara",
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 5,
      prompt: scene.prompt,
      negative_prompt: scene.negativePrompt,
      input_images: await Promise.all([
        dataUrl("07-arden-voss.jpg"),
        dataUrl("09-mara-voss.jpg"),
      ]),
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        scene: "arden-redirection-mara-commitment",
        test: true,
      },
    }],
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "submission.json"), JSON.stringify({
    model: MODEL,
    mode: "480p",
    durationSeconds: 5,
    estimatedCatalogCostUsd: 0.208,
    scene,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitAngles(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-mara-h3-single-angles-v1",
    requests: await Promise.all(singleAvatarAngles.map(async (angle) => ({
      id: angle.id,
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 10,
      prompt: angle.prompt,
      negative_prompt: angleNegativePrompt,
      input_image: await dataUrl(angle.avatar),
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        scene: "arden-redirection-mara-commitment",
        angle: angle.id,
        test: true,
      },
    }))),
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "single-angle-submission.json"), JSON.stringify({
    model: MODEL,
    mode: "480p",
    totalDurationSeconds: 20,
    estimatedCatalogCostUsd: 0.832,
    angles: singleAvatarAngles,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitReferenceOnly(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-h3-reference-only-v1",
    requests: [{
      id: referenceOnly.id,
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 5,
      prompt: referenceOnly.prompt,
      negative_prompt: angleNegativePrompt,
      input_images: [await dataUrl("07-arden-voss.jpg")],
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        test: true,
        conditioning: "reference-only",
      },
    }],
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "reference-only-submission.json"), JSON.stringify({
    model: MODEL,
    mode: "480p",
    durationSeconds: 5,
    estimatedCatalogCostUsd: 0.208,
    referenceOnly,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitBackgroundPlate(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-coastal-room-background-v1",
    requests: [{
      id: "coastal-room-background",
      type: "image",
      model: "gen",
      aspect_ratio: "16:9",
      output_format: "png",
      prompt: backgroundPlate.prompt,
      negative_prompt: "people, person, face, body, silhouette, text, letters, numbers, logo, watermark, signage, screen UI, map",
      metadata: { source: "sharp-tan-reef-reenactment", role: "static-background-plate", test: true },
    }],
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "background-plate-submission.json"), JSON.stringify({
    model: "gen",
    estimatedCatalogCostUsd: 0.0156,
    backgroundPlate,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitCompositeAnchoredAngles(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-mara-h3-composite-anchors-v1",
    requests: await Promise.all(compositeAnchoredAngles.map(async (angle) => ({
      id: angle.id,
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 10,
      prompt: angle.prompt,
      negative_prompt: angleNegativePrompt,
      input_image: await dataUrlAt(path.join(OUTPUT_DIRECTORY, angle.keyframe), "image/png"),
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        scene: "arden-redirection-mara-commitment",
        conditioning: "composite-scene-keyframe",
        angle: angle.id,
        test: true,
      },
    }))),
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "composite-anchors-submission.json"), JSON.stringify({
    model: MODEL,
    mode: "480p",
    totalDurationSeconds: 20,
    estimatedCatalogCostUsd: 0.832,
    angles: compositeAnchoredAngles,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitImageComposedKeyframe(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-pinkimage-keyframe-v1",
    requests: [{
      id: "arden-image-composed-keyframe",
      type: "image",
      model: "pinkimage",
      aspect_ratio: "16:9",
      output_format: "png",
      prompt: imageComposedKeyframe.prompt,
      negative_prompt: "portrait card, collage, floating head, duplicate person, other people, text, letters, logos, watermarks, screen UI, map",
      input_images: [
        await dataUrl("07-arden-voss.jpg"),
        await dataUrlAt(path.join(OUTPUT_DIRECTORY, "coastal-room-background.png"), "image/png"),
      ],
      metadata: { source: "sharp-tan-reef-reenactment", role: "image-composed-keyframe", test: true },
    }],
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "image-composed-keyframe-submission.json"), JSON.stringify({
    model: "pinkimage",
    estimatedCatalogCostUsd: 0.0052,
    imageComposedKeyframe,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitImageComposedShotKeyframes(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-mara-pinkimage-shot-keyframes-v1",
    requests: await Promise.all(imageComposedShotKeyframes.map(async (keyframe) => ({
      id: keyframe.id,
      type: "image",
      model: "pinkimage",
      aspect_ratio: "16:9",
      output_format: "png",
      prompt: keyframe.prompt,
      negative_prompt: "portrait card, collage, floating head, duplicate person, other people, text, letters, logos, watermarks, screen UI, map",
      input_images: [
        await dataUrl(keyframe.avatar),
        await dataUrlAt(path.join(OUTPUT_DIRECTORY, "coastal-room-background.png"), "image/png"),
      ],
      metadata: { source: "sharp-tan-reef-reenactment", role: "image-composed-shot-keyframe", angle: keyframe.id, test: true },
    }))),
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "image-composed-shot-keyframes-submission.json"), JSON.stringify({
    model: "pinkimage",
    estimatedCatalogCostUsd: 0.0104,
    keyframes: imageComposedShotKeyframes,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitImageComposedVideoAngles(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-mara-h3-image-composed-anchors-v1",
    requests: await Promise.all(imageComposedVideoAngles.map(async (angle) => ({
      id: angle.id,
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 10,
      prompt: angle.prompt,
      negative_prompt: angleNegativePrompt,
      input_image: await dataUrlAt(path.join(OUTPUT_DIRECTORY, angle.keyframe), "image/png"),
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        scene: "arden-redirection-mara-commitment",
        conditioning: "two-reference-image-composed-keyframe",
        angle: angle.id,
        test: true,
      },
    }))),
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "image-composed-anchors-submission.json"), JSON.stringify({
    model: MODEL,
    mode: "480p",
    totalDurationSeconds: 20,
    estimatedCatalogCostUsd: 0.832,
    angles: imageComposedVideoAngles,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitOverTheShoulderKeyframes(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-mara-pinkimage-ots-keyframes-v1",
    requests: await Promise.all(overTheShoulderKeyframes.map(async (keyframe) => ({
      id: keyframe.id,
      type: "image",
      model: "pinkimage",
      aspect_ratio: "16:9",
      output_format: "png",
      prompt: keyframe.prompt,
      negative_prompt: "portrait card, collage, empty table, single person, talking to camera, facing camera, duplicate person, extra people, floating head, text, letters, logos, watermarks, screen UI, map",
      input_images: keyframe.id.startsWith("arden")
        ? [
          await dataUrl("07-arden-voss.jpg"),
          await dataUrl("09-mara-voss.jpg"),
          await dataUrlAt(path.join(OUTPUT_DIRECTORY, "coastal-room-background.png"), "image/png"),
        ]
        : [
          await dataUrl("09-mara-voss.jpg"),
          await dataUrl("07-arden-voss.jpg"),
          await dataUrlAt(path.join(OUTPUT_DIRECTORY, "coastal-room-background.png"), "image/png"),
        ],
      metadata: { source: "sharp-tan-reef-private-transcript", role: "over-the-shoulder-keyframe", angle: keyframe.id, test: true },
    }))),
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "ots-keyframes-submission.json"), JSON.stringify({
    model: "pinkimage",
    estimatedCatalogCostUsd: 0.0104,
    keyframes: overTheShoulderKeyframes,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function submitOverTheShoulderVideoAngles(): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: "sharp-tan-reef-arden-mara-h3-ots-anchors-v1",
    requests: await Promise.all(overTheShoulderVideoAngles.map(async (angle) => ({
      id: angle.id,
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 10,
      prompt: angle.prompt,
      negative_prompt: "text, captions, subtitles, logos, watermarks, music, score, singing, music video, direct-to-camera, empty table, solo shot, duplicate characters, face swapping, changing identities, exaggerated acting, shouting, violence, weapon, political campaign, low resolution, flicker",
      input_image: await dataUrlAt(path.join(OUTPUT_DIRECTORY, angle.keyframe), "image/png"),
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        scene: "arden-redirection-mara-commitment",
        conditioning: "three-reference-ots-keyframe",
        angle: angle.id,
        test: true,
      },
    }))),
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, "ots-anchors-submission.json"), JSON.stringify({
    model: MODEL,
    mode: "480p",
    totalDurationSeconds: 20,
    estimatedCatalogCostUsd: 0.832,
    angles: overTheShoulderVideoAngles,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, output: OUTPUT_DIRECTORY }));
}

async function retryOverTheShoulderVideoAngle(angleId: string): Promise<void> {
  const angle = overTheShoulderVideoAngles.find((candidate) => candidate.id === angleId);
  if (!angle) throw new Error(`Unknown over-the-shoulder angle: ${angleId}`);
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const body = {
    client_request_id: `sharp-tan-reef-${angle.id}-retry-${Date.now()}`,
    requests: [{
      id: angle.id,
      type: "video",
      model: MODEL,
      mode: "480p",
      aspect_ratio: "16:9",
      duration_seconds: 10,
      prompt: angle.prompt,
      negative_prompt: "text, captions, subtitles, logos, watermarks, music, score, singing, music video, direct-to-camera, empty table, solo shot, duplicate characters, face swapping, changing identities, exaggerated acting, shouting, violence, weapon, political campaign, low resolution, flicker",
      input_image: await dataUrlAt(path.join(OUTPUT_DIRECTORY, angle.keyframe), "image/png"),
      metadata: {
        source: "sharp-tan-reef-private-transcript",
        scene: "arden-redirection-mara-commitment",
        conditioning: "three-reference-ots-keyframe",
        angle: angle.id,
        retry: true,
      },
    }],
  };
  const result = await katanaFetch("/v1/generation-requests?wait=false", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await writeFile(path.join(OUTPUT_DIRECTORY, `ots-${angle.id}-retry-submission.json`), JSON.stringify({
    model: MODEL,
    mode: "480p",
    durationSeconds: 10,
    estimatedCatalogCostUsd: 0.416,
    angle,
    result,
  }, null, 2));
  console.log(JSON.stringify({ requestId: result.request_id, status: result.status, angle: angle.id, output: OUTPUT_DIRECTORY }));
}

function outputAssetUrl(result: Record<string, unknown>): string | null {
  const responses = result.responses;
  if (!Array.isArray(responses)) return null;
  for (const response of responses) {
    if (!response || typeof response !== "object") continue;
    const assets = (response as { output_assets?: unknown }).output_assets;
    if (!Array.isArray(assets)) continue;
    for (const asset of assets) {
      if (!asset || typeof asset !== "object") continue;
      const value = (asset as { original_data_url?: unknown; url?: unknown }).original_data_url
        ?? (asset as { url?: unknown }).url;
      if (typeof value === "string") return value;
    }
  }
  return null;
}

async function poll(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "latest-status.json"), JSON.stringify(result, null, 2));
  const status = typeof result.status === "string" ? result.status : "unknown";
  const assetUrl = outputAssetUrl(result);
  if (!assetUrl) {
    console.log(JSON.stringify({ requestId, status, completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const download = await fetch(assetUrl);
  const contentType = download.headers.get("content-type") ?? "";
  if (!download.ok || !contentType.startsWith("video/")) {
    throw new Error(`Katana output download failed (${download.status}, ${contentType}).`);
  }
  const videoPath = path.join(OUTPUT_DIRECTORY, "arden-mara-h3-proof.mp4");
  await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
  console.log(JSON.stringify({ requestId, status, completed: true, videoPath, contentType }));
}

async function pollAngles(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "single-angle-status.json"), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const completed = responses.every((response) => response && typeof response === "object"
    && (response as { status?: unknown }).status === "completed");
  if (!completed) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const outputs: string[] = [];
  for (const angle of singleAvatarAngles) {
    const response = responses.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === angle.id) as Record<string, unknown> | undefined;
    const assetUrl = response ? outputAssetUrl({ responses: [response] }) : null;
    if (!assetUrl) throw new Error(`${angle.id} completed without an output asset.`);
    const download = await fetch(assetUrl);
    const contentType = download.headers.get("content-type") ?? "";
    if (!download.ok || !contentType.startsWith("video/")) {
      throw new Error(`${angle.id} output download failed (${download.status}, ${contentType}).`);
    }
    const videoPath = path.join(OUTPUT_DIRECTORY, angle.filename);
    await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
    outputs.push(videoPath);
  }
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, outputs }));
}

async function pollReferenceOnly(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "reference-only-status.json"), JSON.stringify(result, null, 2));
  const assetUrl = outputAssetUrl(result);
  if (!assetUrl) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const download = await fetch(assetUrl);
  const contentType = download.headers.get("content-type") ?? "";
  if (!download.ok || !contentType.startsWith("video/")) {
    throw new Error(`Katana output download failed (${download.status}, ${contentType}).`);
  }
  const videoPath = path.join(OUTPUT_DIRECTORY, "arden-reference-only.mp4");
  await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, videoPath }));
}

async function pollBackgroundPlate(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "background-plate-status.json"), JSON.stringify(result, null, 2));
  const assetUrl = outputAssetUrl(result);
  if (!assetUrl) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const download = await fetch(assetUrl);
  const contentType = download.headers.get("content-type") ?? "";
  if (!download.ok || !contentType.startsWith("image/")) {
    throw new Error(`Katana background download failed (${download.status}, ${contentType}).`);
  }
  const imagePath = path.join(OUTPUT_DIRECTORY, "coastal-room-background.png");
  await writeFile(imagePath, Buffer.from(await download.arrayBuffer()));
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, imagePath }));
}

async function pollCompositeAnchoredAngles(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "composite-anchors-status.json"), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const completed = responses.every((response) => response && typeof response === "object"
    && (response as { status?: unknown }).status === "completed");
  if (!completed) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const outputs: string[] = [];
  for (const angle of compositeAnchoredAngles) {
    const response = responses.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === angle.id) as Record<string, unknown> | undefined;
    const assetUrl = response ? outputAssetUrl({ responses: [response] }) : null;
    if (!assetUrl) throw new Error(`${angle.id} completed without an output asset.`);
    const download = await fetch(assetUrl);
    const contentType = download.headers.get("content-type") ?? "";
    if (!download.ok || !contentType.startsWith("video/")) {
      throw new Error(`${angle.id} output download failed (${download.status}, ${contentType}).`);
    }
    const videoPath = path.join(OUTPUT_DIRECTORY, angle.filename);
    await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
    outputs.push(videoPath);
  }
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, outputs }));
}

async function pollImageComposedKeyframe(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "image-composed-keyframe-status.json"), JSON.stringify(result, null, 2));
  const assetUrl = outputAssetUrl(result);
  if (!assetUrl) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const download = await fetch(assetUrl);
  const contentType = download.headers.get("content-type") ?? "";
  if (!download.ok || !contentType.startsWith("image/")) {
    throw new Error(`Katana keyframe download failed (${download.status}, ${contentType}).`);
  }
  const imagePath = path.join(OUTPUT_DIRECTORY, "arden-image-composed-keyframe.png");
  await writeFile(imagePath, Buffer.from(await download.arrayBuffer()));
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, imagePath }));
}

async function pollImageComposedShotKeyframes(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "image-composed-shot-keyframes-status.json"), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const completed = responses.every((response) => response && typeof response === "object"
    && (response as { status?: unknown }).status === "completed");
  if (!completed) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const outputs: string[] = [];
  for (const keyframe of imageComposedShotKeyframes) {
    const response = responses.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === keyframe.id) as Record<string, unknown> | undefined;
    const assetUrl = response ? outputAssetUrl({ responses: [response] }) : null;
    if (!assetUrl) throw new Error(`${keyframe.id} completed without an output asset.`);
    const download = await fetch(assetUrl);
    const contentType = download.headers.get("content-type") ?? "";
    if (!download.ok || !contentType.startsWith("image/")) {
      throw new Error(`${keyframe.id} output download failed (${download.status}, ${contentType}).`);
    }
    const imagePath = path.join(OUTPUT_DIRECTORY, keyframe.filename);
    await writeFile(imagePath, Buffer.from(await download.arrayBuffer()));
    outputs.push(imagePath);
  }
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, outputs }));
}

async function pollImageComposedVideoAngles(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "image-composed-anchors-status.json"), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const completed = responses.every((response) => response && typeof response === "object"
    && (response as { status?: unknown }).status === "completed");
  if (!completed) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const outputs: string[] = [];
  for (const angle of imageComposedVideoAngles) {
    const response = responses.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === angle.id) as Record<string, unknown> | undefined;
    const assetUrl = response ? outputAssetUrl({ responses: [response] }) : null;
    if (!assetUrl) throw new Error(`${angle.id} completed without an output asset.`);
    const download = await fetch(assetUrl);
    const contentType = download.headers.get("content-type") ?? "";
    if (!download.ok || !contentType.startsWith("video/")) {
      throw new Error(`${angle.id} output download failed (${download.status}, ${contentType}).`);
    }
    const videoPath = path.join(OUTPUT_DIRECTORY, angle.filename);
    await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
    outputs.push(videoPath);
  }
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, outputs }));
}

async function pollOverTheShoulderKeyframes(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "ots-keyframes-status.json"), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const completed = responses.every((response) => response && typeof response === "object"
    && (response as { status?: unknown }).status === "completed");
  if (!completed) {
    console.log(JSON.stringify({ requestId, status: result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const outputs: string[] = [];
  for (const keyframe of overTheShoulderKeyframes) {
    const response = responses.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === keyframe.id) as Record<string, unknown> | undefined;
    const assetUrl = response ? outputAssetUrl({ responses: [response] }) : null;
    if (!assetUrl) throw new Error(`${keyframe.id} completed without an output asset.`);
    const download = await fetch(assetUrl);
    const contentType = download.headers.get("content-type") ?? "";
    if (!download.ok || !contentType.startsWith("image/")) {
      throw new Error(`${keyframe.id} output download failed (${download.status}, ${contentType}).`);
    }
    const imagePath = path.join(OUTPUT_DIRECTORY, keyframe.filename);
    await writeFile(imagePath, Buffer.from(await download.arrayBuffer()));
    outputs.push(imagePath);
  }
  console.log(JSON.stringify({ requestId, status: result.status, completed: true, outputs }));
}

async function pollOverTheShoulderVideoAngles(requestId: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, "ots-anchors-status.json"), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const outputs: string[] = [];
  for (const angle of overTheShoulderVideoAngles) {
    const response = responses.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as { id?: unknown }).id === angle.id) as Record<string, unknown> | undefined;
    if ((response as { status?: unknown } | undefined)?.status !== "completed") continue;
    const assetUrl = response ? outputAssetUrl({ responses: [response] }) : null;
    if (!assetUrl) throw new Error(`${angle.id} completed without an output asset.`);
    const videoPath = path.join(OUTPUT_DIRECTORY, angle.filename);
    if (!(await Bun.file(videoPath).exists())) {
      const download = await fetch(assetUrl);
      const contentType = download.headers.get("content-type") ?? "";
      if (!download.ok || !contentType.startsWith("video/")) {
        throw new Error(`${angle.id} output download failed (${download.status}, ${contentType}).`);
      }
      await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
    }
    outputs.push(videoPath);
  }
  const completed = responses.length === overTheShoulderVideoAngles.length && responses.every((response) => response && typeof response === "object"
    && (response as { status?: unknown }).status === "completed");
  console.log(JSON.stringify({ requestId, status: result.status, completed, outputs, output: OUTPUT_DIRECTORY }));
}

async function pollOverTheShoulderVideoAngle(requestId: string, angleId: string): Promise<void> {
  const angle = overTheShoulderVideoAngles.find((candidate) => candidate.id === angleId);
  if (!angle) throw new Error(`Unknown over-the-shoulder angle: ${angleId}`);
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  await writeFile(path.join(OUTPUT_DIRECTORY, `ots-${angle.id}-retry-status.json`), JSON.stringify(result, null, 2));
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const response = responses.find((candidate) => candidate && typeof candidate === "object"
    && (candidate as { id?: unknown }).id === angle.id) as Record<string, unknown> | undefined;
  if ((response as { status?: unknown } | undefined)?.status !== "completed") {
    console.log(JSON.stringify({ requestId, angle: angle.id, status: response?.status ?? result.status ?? "unknown", completed: false, output: OUTPUT_DIRECTORY }));
    return;
  }
  const assetUrl = outputAssetUrl({ responses: [response] });
  if (!assetUrl) throw new Error(`${angle.id} completed without an output asset.`);
  const download = await fetch(assetUrl);
  const contentType = download.headers.get("content-type") ?? "";
  if (!download.ok || !contentType.startsWith("video/")) {
    throw new Error(`${angle.id} output download failed (${download.status}, ${contentType}).`);
  }
  const videoPath = path.join(OUTPUT_DIRECTORY, angle.filename);
  await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
  console.log(JSON.stringify({ requestId, angle: angle.id, status: result.status, completed: true, videoPath }));
}

async function recoverOverTheShoulderVideoAngle(requestId: string, angleId: string, outputFilename: string): Promise<void> {
  const angle = overTheShoulderVideoAngles.find((candidate) => candidate.id === angleId);
  if (!angle) throw new Error(`Unknown over-the-shoulder angle: ${angleId}`);
  if (path.basename(outputFilename) !== outputFilename || !outputFilename.endsWith(".mp4")) {
    throw new Error("output filename must be a bare .mp4 filename");
  }
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const videoPath = path.join(OUTPUT_DIRECTORY, outputFilename);
  if (await Bun.file(videoPath).exists()) throw new Error(`Refusing to overwrite existing output: ${videoPath}`);
  const result = await katanaFetch(`/v1/generation-requests/${encodeURIComponent(requestId)}`);
  const responses = Array.isArray(result.responses) ? result.responses : [];
  const response = responses.find((candidate) => candidate && typeof candidate === "object"
    && (candidate as { id?: unknown }).id === angle.id) as Record<string, unknown> | undefined;
  if ((response as { status?: unknown } | undefined)?.status !== "completed") {
    throw new Error(`${angle.id} is not completed in request ${requestId}`);
  }
  const assetUrl = outputAssetUrl({ responses: [response] });
  if (!assetUrl) throw new Error(`${angle.id} completed without an output asset.`);
  const download = await fetch(assetUrl);
  const contentType = download.headers.get("content-type") ?? "";
  if (!download.ok || !contentType.startsWith("video/")) {
    throw new Error(`${angle.id} output download failed (${download.status}, ${contentType}).`);
  }
  await writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
  console.log(JSON.stringify({ requestId, angle: angle.id, recovered: true, videoPath }));
}

const [command, requestId, angleId, outputFilename] = process.argv.slice(2);
if (command === "submit") await submit();
else if (command === "submit-angles") await submitAngles();
else if (command === "submit-reference-only") await submitReferenceOnly();
else if (command === "submit-background-plate") await submitBackgroundPlate();
else if (command === "submit-composite-anchors") await submitCompositeAnchoredAngles();
else if (command === "submit-image-composed-keyframe") await submitImageComposedKeyframe();
else if (command === "submit-image-composed-shot-keyframes") await submitImageComposedShotKeyframes();
else if (command === "submit-image-composed-video-angles") await submitImageComposedVideoAngles();
else if (command === "submit-ots-keyframes") await submitOverTheShoulderKeyframes();
else if (command === "submit-ots-video-angles") await submitOverTheShoulderVideoAngles();
else if (command === "retry-ots-video-angle" && requestId) await retryOverTheShoulderVideoAngle(requestId);
else if (command === "poll" && requestId) await poll(requestId);
else if (command === "poll-angles" && requestId) await pollAngles(requestId);
else if (command === "poll-reference-only" && requestId) await pollReferenceOnly(requestId);
else if (command === "poll-background-plate" && requestId) await pollBackgroundPlate(requestId);
else if (command === "poll-composite-anchors" && requestId) await pollCompositeAnchoredAngles(requestId);
else if (command === "poll-image-composed-keyframe" && requestId) await pollImageComposedKeyframe(requestId);
else if (command === "poll-image-composed-shot-keyframes" && requestId) await pollImageComposedShotKeyframes(requestId);
else if (command === "poll-image-composed-video-angles" && requestId) await pollImageComposedVideoAngles(requestId);
else if (command === "poll-ots-keyframes" && requestId) await pollOverTheShoulderKeyframes(requestId);
else if (command === "poll-ots-video-angles" && requestId) await pollOverTheShoulderVideoAngles(requestId);
else if (command === "poll-ots-video-angle" && requestId && angleId) await pollOverTheShoulderVideoAngle(requestId, angleId);
else if (command === "recover-ots-video-angle" && requestId && angleId && outputFilename) await recoverOverTheShoulderVideoAngle(requestId, angleId, outputFilename);
else throw new Error("Usage: bun scripts/katana-video-proof.ts submit | submit-angles | submit-reference-only | submit-background-plate | submit-composite-anchors | submit-image-composed-keyframe | submit-image-composed-shot-keyframes | submit-image-composed-video-angles | submit-ots-keyframes | submit-ots-video-angles | retry-ots-video-angle <angle-id> | poll <request-id> | poll-angles <request-id> | poll-reference-only <request-id> | poll-background-plate <request-id> | poll-composite-anchors <request-id> | poll-image-composed-keyframe <request-id> | poll-image-composed-shot-keyframes | poll-image-composed-video-angles | poll-ots-keyframes | poll-ots-video-angles <request-id> | poll-ots-video-angle <request-id> <angle-id> | recover-ots-video-angle <request-id> <angle-id> <output-filename>");
