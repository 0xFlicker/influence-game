"use client";

import { useEffect, useRef, useState } from "react";
import { uploadProfilePicture, type PersonaKey } from "@/lib/api";
import { AgentAvatarPreview } from "./agent-avatar-preview";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

interface AvatarUploadProps {
  editLabel?: string;
  disabled?: boolean;
  onEdit?: () => void;
  currentUrl?: string | null;
  persona: PersonaKey;
  name: string;
  onUploaded: (publicUrl: string) => void;
  onUploadError?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  size?: "16" | "32";
  presentation?: "portrait" | "full-body";
}

export function AvatarUpload({
  editLabel,
  disabled = false,
  onEdit,
  currentUrl,
  persona,
  name,
  onUploaded,
  onUploadingChange,
  onUploadError,
  size = "16",
  presentation = "portrait",
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);
  const operationEpoch = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => () => {
    operationEpoch.current += 1;
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || disabled || uploading) return;

    // Reset input so re-selecting the same file triggers onChange
    e.target.value = "";

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Only PNG, JPEG, and WebP images are allowed.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("Image must be under 2 MB.");
      return;
    }

    setError(null);
    const epoch = ++operationEpoch.current;
    setUploading(true);
    onUploadingChange?.(true);

    // Show local preview immediately
    const localPreview = URL.createObjectURL(file);
    localPreviewRef.current = localPreview;
    setPreviewUrl(localPreview);

    try {
      const { publicUrl } = await uploadProfilePicture(file);
      if (epoch !== operationEpoch.current) return;

      URL.revokeObjectURL(localPreview);
      localPreviewRef.current = null;
      setPreviewUrl(publicUrl);
      onUploaded(publicUrl);
    } catch (err) {
      if (epoch !== operationEpoch.current) return;
      URL.revokeObjectURL(localPreview);
      localPreviewRef.current = null;
      setPreviewUrl(null);
      onUploadError?.();
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      if (epoch === operationEpoch.current) {
        setUploading(false);
        onUploadingChange?.(false);
      }
    }
  }

  const displayUrl = previewUrl ?? currentUrl;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {onEdit && displayUrl ? <button type="button" disabled={disabled || uploading} onClick={onEdit} aria-label={`Edit ${name || "Agent"} ${presentation === "full-body" ? "full-body image" : "portrait"}`} className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-owned character image opens its crop editor */}
          <img src={displayUrl} alt={`${name || "Agent"} ${presentation}`} className={presentation === "full-body" ? "h-64 w-44 rounded-lg bg-black/20 object-contain" : "h-32 w-32 rounded-full object-cover"} />
        </button> : presentation === "full-body" ? (
          displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-uploaded reference, preserve entire framing
            <img src={displayUrl} alt={`${name || "Agent"} full-body reference`} className="h-64 w-44 rounded-lg bg-black/20 object-contain" />
          ) : <div className="flex h-64 w-44 items-center justify-center rounded-lg border border-white/15 p-4 text-center text-sm text-white/45">Upload a full-body reference</div>
        ) : <AgentAvatarPreview
          avatarUrl={displayUrl}
          personaKey={persona}
          name={name}
          gamesPlayed={null}
          gamesWon={null}
          size={size}
        />}
        {uploading && (
          <div
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin"
            aria-hidden="true"
          />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => editLabel && onEdit ? onEdit() : inputRef.current?.click()}
        disabled={disabled || uploading}
        className="min-h-11 rounded-lg px-3 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
      >
        {uploading ? "Uploading..." : editLabel ?? (presentation === "full-body" ? "Change full-body reference" : "Change portrait")}
      </button>

      {error && <p role="alert" className="text-red-400 text-xs text-center max-w-48">{error}</p>}
    </div>
  );
}
