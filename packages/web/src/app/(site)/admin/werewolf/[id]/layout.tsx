import { GameWorkspace } from "@/app/admin/werewolf/workspace";
export default async function Layout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) { const { id } = await params; return <GameWorkspace key={id} gameId={id}>{children}</GameWorkspace>; }
