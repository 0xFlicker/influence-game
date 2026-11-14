import {expect,test} from "bun:test";
import {preparePlaybackPointer} from "./public-playback-pointer";
import {pointerFixture} from "./public-playback-pointer-fixture";

test("pointer plan retains source/history and requires every target version",()=>{
  const input=pointerFixture(),saved=structuredClone(input.before),plan=preparePlaybackPointer(input);
  expect(input.before).toEqual(saved);
  expect(plan.after.current_ready_render_version).toBe(7);
  expect(plan.after.current_ready_published_at).toBe(saved.current_ready_published_at);
  expect(plan.after.current_ready_artifact_metadata.video.sha256).toBe(saved.current_ready_artifact_metadata.video.sha256);
  expect(plan.after.current_ready_artifact_metadata.manifest.objectKey).toContain("delivery-v1/");
  expect(plan.receipt.pointerUpdated).toBe(false);
  expect(plan.forwardSql).toContain("FOR UPDATE");
  expect(plan.forwardSql).not.toContain("O'Brien");
  expect(plan.rollbackSql).not.toBe(plan.forwardSql);
  for (const mutate of [()=>input.verifiedTargets.pop(),()=>{input.verifiedTargets[0].sha256="0".repeat(64);},()=>{input.verifiedTargets[0].version="null";}]) {
    const copy=structuredClone(input.verifiedTargets);mutate();expect(()=>preparePlaybackPointer(input)).toThrow();input.verifiedTargets=copy;
  }
});

test("an in-progress newer attempt is preserved independently of published media",()=>{
  const input=pointerFixture();input.before.status="rendering";input.before.render_version=8;
  input.before.artifact_metadata={...input.before.artifact_metadata,preview:{title:"New attempt",description:"Do not overwrite"}};
  const plan=preparePlaybackPointer(input);
  expect(plan.after.artifact_metadata).toEqual(input.before.artifact_metadata);
  expect(plan.after.current_ready_artifact_metadata).not.toEqual(input.before.current_ready_artifact_metadata);
  expect(plan.after.render_version).toBe(8);
});

test("source binding, readback and environment drift reject reconciliation",()=>{
  for (const variant of ["source","readback","environment","key","dimensions"] as const) {
    const input=pointerFixture();
    if(variant==="source") input.sourceSha256="0".repeat(64);
    if(variant==="readback") input.targetPlaybackBytes=new Uint8Array([0]);
    if(variant==="environment") input.delivery.publicBaseUrl="https://assets.thehouse.game";
    if(variant==="key") input.before.current_ready_artifact_metadata.video.objectKey="postgame-media/wrong.mp4";
    if(variant==="dimensions") input.before.current_ready_artifact_metadata.video.width=1;
    expect(()=>preparePlaybackPointer(input)).toThrow();
  }
});
