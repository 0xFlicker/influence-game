import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WerewolfAdmin } from "../../workspace";
export default async function Page({ params }: { params: Promise<{ id: string; section: string }> }) {
  const { id, section } = await params;
  if (section !== "production" && section !== "costs" && section !== "activity") notFound();
  return <Suspense><WerewolfAdmin gameId={id} section={section} /></Suspense>;
}
