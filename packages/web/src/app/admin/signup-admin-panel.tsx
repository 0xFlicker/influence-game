"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, type SignupAvailability } from "@/lib/api";

const field = "min-h-11 rounded-lg border border-white/25 bg-black/30 px-3 text-white focus-visible:outline-2 focus-visible:outline-indigo-300";
const primary = "influence-button-primary min-h-11 rounded-lg px-4";
const secondary = "influence-button-secondary min-h-11 rounded-lg px-4";
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

export function SignupSettings() {
  const [rate, setRate] = useState("");
  const [saved, setSaved] = useState<SignupAvailability | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const path = "/api/admin/signup-settings";

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<SignupAvailability>(path, { signal: controller.signal }).then(value => {
      setRate(String(value.rate)); setSaved(value);
    }, failure => { if (!controller.signal.aborted) setError(message(failure)); });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setFeedback("");
    try {
      const result = await apiFetch<SignupAvailability>(path, { method: "PATCH", body: JSON.stringify({ rate: Number(rate) }) });
      setRate(String(result.rate)); setSaved(result); setFeedback("Signup rate saved.");
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }

  return <section className="max-w-2xl space-y-4">
    <h1 className="text-2xl font-semibold">Signups</h1>
    <p className="text-white/70">Signup slots refill continuously. The daily rate also sets how many unused slots can be available at once.</p>
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 p-5">
      <label className="block font-medium" htmlFor="signup-rate">Accounts per 24 hours</label>
      <div className="flex flex-wrap gap-3">
        <input id="signup-rate" className={`${field} w-48`} type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1}
          required value={rate} disabled={!saved || busy} onChange={event => setRate(event.target.value)} />
        <button className={primary} disabled={!saved || busy || Number(rate) === saved.rate}>{busy ? "Saving…" : "Save rate"}</button>
      </div>
      {saved && <p className="text-sm text-white/65">One slot refills about every {Math.max(1, Math.ceil(1440 / saved.rate))} minutes.</p>}
      {!saved && !error && <p role="status">Loading signup settings…</p>}
      {feedback && <p role="status">{feedback}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </form>
  </section>;
}

type Campaign = { id: string; label: string; startsAt: string; endsAt: string; closedAt: string | null };
const campaignsPath = "/api/admin/signup-campaigns";

export function SignupCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<Campaign[]>(campaignsPath, { signal: controller.signal }).then(setCampaigns,
      failure => { if (!controller.signal.aborted) setError(message(failure)); });
    return () => controller.abort();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError(""); setLink(""); setCopied(false);
    try {
      const startsAt = new Date(String(fields.get("startsAt"))).toISOString();
      const endsAt = new Date(String(fields.get("endsAt"))).toISOString();
      const label = String(fields.get("label")).trim();
      const { code, id } = await apiFetch<{ id: string; code: string }>(campaignsPath, {
        method: "POST", body: JSON.stringify({ label, startsAt, endsAt }),
      });
      setLink(`${location.origin}${fields.get("landing")}#signup_campaign=${code}`);
      setCampaigns(current => [...(current ?? []), { id, label, startsAt, endsAt, closedAt: null }]);
      form.reset();
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }

  async function close(id: string) {
    setBusy(true); setError("");
    try {
      await apiFetch(`${campaignsPath}/${id}/close`, { method: "POST" });
      setCampaigns(current => current?.map(item => item.id === id ? { ...item, closedAt: new Date().toISOString() } : item) ?? null);
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }

  return <section className="mt-8 space-y-4 rounded-xl border border-white/10 p-5">
    <h2 className="text-lg font-semibold">Signup campaigns</h2>
    <p className="text-white/70">Active campaign links grant one signup per session. Sessions already issued expire after 24 hours.</p>
    <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">Campaign name<input name="label" className={field} required maxLength={100} /></label>
      <label className="grid gap-1">Landing page<select name="landing" className={field}>
        <option value="/season-1">Season 1</option><option value="/season-1/create">Character creation</option>
        <option value="/season-1/ai">AI campaign</option><option value="/sign-up">Signup</option>
      </select></label>
      <label className="grid gap-1">Starts (local time)<input name="startsAt" type="datetime-local" className={field} required /></label>
      <label className="grid gap-1">Ends (local time)<input name="endsAt" type="datetime-local" className={field} required /></label>
      <button className={`${primary} justify-self-start`} disabled={busy}>Create campaign link</button>
    </form>
    {link && <div className="space-y-2" data-analytics-private>
      <label className="block" htmlFor="campaign-link">Copy this campaign link now</label>
      <input id="campaign-link" value={link} readOnly className={`${field} w-full`} onFocus={event => event.currentTarget.select()} />
      <button className={secondary} onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setError("Select and copy the link from the field."))}>{copied ? "Copied" : "Copy link"}</button>
    </div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!campaigns && !error && <p role="status">Loading campaigns…</p>}
    {campaigns?.length === 0 && <p className="text-white/65">No signup campaigns.</p>}
    <ul className="divide-y divide-white/10">
      {campaigns?.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="font-medium">{item.label}</p><p className="text-sm text-white/65">
          {new Date(item.startsAt).toLocaleString()} – {new Date(item.endsAt).toLocaleString()}
        </p></div>
        {item.closedAt ? <span className="text-sm text-white/65">Closed</span>
          : Date.parse(item.endsAt) <= Date.now() ? <span className="text-sm text-white/65">Expired</span>
          : <button className={secondary} disabled={busy} onClick={() => void close(item.id)}>Close campaign</button>}
      </li>)}
    </ul>
  </section>;
}
