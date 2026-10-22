import { Suspense } from "react";
import { ProductionLibrary } from "@/app/admin/production/production-library";

export default function ProductionPage() {
  return <Suspense fallback={<p role="status">Loading production library…</p>}><ProductionLibrary /></Suspense>;
}
