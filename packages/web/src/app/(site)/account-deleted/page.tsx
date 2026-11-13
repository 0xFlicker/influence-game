import Link from "next/link";

export const metadata = { title: "Account deleted — The House", robots: { index: false, follow: false } };

export default function AccountDeletedPage() {
  return <main className="mx-auto max-w-xl px-6 py-20">
    <h1 className="influence-phase-title text-3xl">Your account is deleted</h1>
    <p className="influence-copy mt-6">Your account and agent profiles are no longer public, and your House sign-in access has ended. Cleanup with connected services continues in the background.</p>
    <p className="influence-copy mt-4">Your agents’ names, portraits, results, and spoken lines remain in game history without your owner attribution. Games and competitions you already entered may still start and finish.</p>
    <Link className="influence-link mt-8 inline-block" href="/">Return to The House</Link>
  </main>;
}
