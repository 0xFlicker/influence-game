import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminSessionProvider } from "../app/admin/admin-session";
export function adminTestWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}><AdminSessionProvider scope="test-session">{children}</AdminSessionProvider></QueryClientProvider>;
  };
}
