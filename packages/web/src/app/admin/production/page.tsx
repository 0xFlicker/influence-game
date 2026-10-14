import { Suspense } from "react";
import { ProductionLibrary } from "./production-library";

export default function ProductionPage() {
  return <Suspense fallback={<p role="status">Loading production library…</p>}><ProductionLibrary /></Suspense>;
}
