import { Nav } from "@/components/nav";
import { AuthGate } from "@/components/auth-gate";
import { Recovery } from "./recovery";
export default function RecoveryPage() { return <div className="influence-page min-h-screen"><Nav /><AuthGate><Recovery /></AuthGate></div>; }
