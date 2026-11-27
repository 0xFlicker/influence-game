"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getSignupAvailability, type SignupAvailability } from "@/lib/api";

const CHECKING_SIGNUP_AVAILABILITY = "Checking signup availability…";

export function useSignupAvailability(nextAvailableAt?: string) {
  const [status, setStatus] = useState<SignupAvailability | null>(
    nextAvailableAt ? { available: false, nextAvailableAt, rate: 0 } : null,
  );
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const active = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setChecking(true);
    setCheckedAt(Date.now());
    try {
      const result = await getSignupAvailability(AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]));
      if (controller.signal.aborted) return;
      setStatus(result);
      setCheckedAt(Date.now());
      setFailed(false);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    return () => active.current?.abort();
  }, [check]);

  useEffect(() => {
    if (checking || failed || status?.available || !status?.nextAvailableAt) return;
    const delay = Math.max(1000, Date.parse(status.nextAvailableAt) - Date.now());
    const timer = window.setTimeout(() => void check(), delay);
    return () => window.clearTimeout(timer);
  }, [check, checking, failed, status]);

  return { status, checking, failed, check, checkedAt };
}

export function SignupAvailabilityNotice({ status, checking, failed, check, checkedAt }: ReturnType<typeof useSignupAvailability>) {
  const minutes = status?.nextAvailableAt && checkedAt !== null
    ? Math.max(1, Math.ceil((Date.parse(status.nextAvailableAt) - checkedAt) / 60_000))
    : null;
  const wait = minutes === null ? null : minutes < 60
    ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    : formatHourWait(minutes);

  return (
    <div className="space-y-3">
      {wait !== null ? (
        <p role="status" className="leading-relaxed">
          <strong className="font-semibold text-text-primary">Signups are full.</strong>{" "}
          Try again in about {wait}.
        </p>
      ) : checking ? <p role="status">{CHECKING_SIGNUP_AVAILABILITY}</p> : null}
      {failed && <p role="alert">Signup availability is temporarily unavailable.</p>}
      {(!checking || minutes !== null) && (
        <button type="button" disabled={checking} className="influence-button-secondary min-h-11 rounded-lg px-3 py-2 text-sm"
          onClick={() => void check()}>
          Check again
        </button>
      )}
    </div>
  );
}

function formatHourWait(minutes: number) {
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function SignupAvailabilityGate({ children, heading, pending }: {
  children: ReactNode;
  heading?: ReactNode;
  pending?: ReactNode;
}) {
  const availability = useSignupAvailability();
  if (availability.status?.available) return children;
  if (pending && availability.checking && !availability.status && !availability.failed) {
    return (
      <>
        {heading}
        <p role="status" className="sr-only">{CHECKING_SIGNUP_AVAILABILITY}</p>
        {pending}
      </>
    );
  }

  return (
    <div className="influence-copy space-y-3 text-sm">
      {heading}
      <SignupAvailabilityNotice {...availability} />
    </div>
  );
}
