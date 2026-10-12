"use client";
import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from "react";
import {Group, Panel, Separator, type GroupImperativeHandle} from "react-resizable-panels";
import styles from "./workspace.module.css";

const preference = "house.studio.moments-width";
/** Resize only editing panes. The same Player host survives pane and breakpoint changes. */
export function StudioWorkspaceLayout({browser, monitor, properties, transport, mobilePanel, panelControls, resetSignal}: {browser: ReactNode; monitor: ReactNode; properties: ReactNode; transport: ReactNode; mobilePanel: string; panelControls: ReactNode; resetSignal: number}) {
  const [narrow, setNarrow] = useState(false), [previewShare, setPreviewShare] = useState(68), group = useRef<GroupImperativeHandle>(null);
  useEffect(() => {const media = matchMedia("(max-width:700px)"); const changed = () => setNarrow(media.matches); changed(); media.addEventListener("change", changed); return () => media.removeEventListener("change", changed);}, []);
  useEffect(() => {
    if (narrow) {group.current?.setLayout(mobilePanel === "moments" ? {moments: 40, preview: 60} : {moments: 0, preview: 100}); return;}
    const stored = Number(localStorage.getItem(preference)), width = stored > 0 && stored < 100 ? stored : 32;
    group.current?.setLayout({moments: width, preview: 100 - width});
  }, [narrow, mobilePanel, resetSignal]);
  const browserPane = <Panel key="moments" id="moments" defaultSize="32%" minSize={narrow ? mobilePanel === "moments" ? "25%" : "0%" : "230px"} maxSize={narrow && mobilePanel === "properties" ? "0%" : undefined} className={styles.browserPane}>{browser}</Panel>;
  const previewPane = <Panel key="preview" id="preview" minSize={narrow ? "35%" : "350px"} className={styles.previewPane}>
        {monitor}{panelControls}{properties}
      </Panel>;
  const separator = <Separator key="separator" aria-label="Resize moments and preview" className={styles.paneSeparator} onDoubleClick={() => {localStorage.removeItem(preference); group.current?.setLayout({moments: 32, preview: 68});}} />;
  return <div className={styles.workspace} data-mobile-panel={mobilePanel} style={{"--studio-monitor-share": `${Math.max(40, Math.min(72, previewShare))}%`} as CSSProperties}>
    <Group groupRef={group} orientation={narrow ? "vertical" : "horizontal"} disabled={narrow} className={styles.paneGroup} onLayoutChange={layout => setPreviewShare(layout.preview ?? 68)} onLayoutChanged={(layout, meta) => {if (!narrow && meta.isUserInteraction) localStorage.setItem(preference, String(meta.requestedLayout?.moments ?? layout.moments));}}>
      {narrow ? [previewPane, browserPane] : [browserPane, separator, previewPane]}
    </Group>
    {transport}
  </div>;
}
