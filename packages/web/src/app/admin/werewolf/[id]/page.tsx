import { Suspense } from "react";
import { WerewolfAdmin } from "../workspace";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <Suspense><WerewolfAdmin gameId={id} /></Suspense>;
}
