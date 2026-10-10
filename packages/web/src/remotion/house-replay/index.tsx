import { Composition, registerRoot, getInputProps } from "remotion";
import { ReplayFrame } from "./frame";
import type { ReplayManifest } from "../../lib/replay-export/manifest";
registerRoot(() => (
  <Composition
    id="HouseReplay"
    component={ReplayFrame}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={getInputProps<{
      manifest: ReplayManifest;
      prepare?: boolean;
    }>()}
    calculateMetadata={({
      props,
    }: {
      props: { manifest: ReplayManifest; prepare?: boolean };
    }) => ({
      width: props.manifest.width,
      height: props.manifest.height,
      fps: props.manifest.fps,
      durationInFrames: props.prepare
        ? props.manifest.cues.length * 2
        : props.manifest.range.untilFrame - props.manifest.range.fromFrame,
    })}
  />
));
