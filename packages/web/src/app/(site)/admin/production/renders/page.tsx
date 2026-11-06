import {Suspense} from "react";
import {RenderJobMonitor} from "@/app/admin/production/render-job-monitor";
export default function RenderJobsPage() {
  return <Suspense fallback={<p role="status">Loading render jobs…</p>}><RenderJobMonitor/></Suspense>;
}
