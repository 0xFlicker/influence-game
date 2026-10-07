import { notFound } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; if (!["production", "costs", "activity"].includes(section)) notFound(); return null; }
