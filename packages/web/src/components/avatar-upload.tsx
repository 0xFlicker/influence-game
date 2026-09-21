"use client";

import { useEffect, useRef, useState } from "react";
import { uploadProfilePicture, type PersonaKey } from "@/lib/api";
import { AgentAvatarPreview } from "./agent-avatar-preview";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

interface AvatarUploadProps {
  currentUrl?: string | null;
  persona: PersonaKey;
  name: string;
  onUploaded: (publicUrl: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  size?: "16" | "32";
  presentation?: "portrait" | "full-body";
}

export function AvatarUpload({
  currentUrl,
  persona,
  name,
  onUploaded,
  onUploadingChange,
  size = "16",
  presentation = "portrait",
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

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
    setUploading(true);
    onUploadingChange?.(true);

    // Show local preview immediately
    const localPreview = URL.createObjectURL(file);
    localPreviewRef.current = localPreview;
    setPreviewUrl(localPreview);

    try {
      const { publicUrl } = await uploadProfilePicture(file);

      URL.revokeObjectURL(localPreview);
      localPreviewRef.current = null;
      setPreviewUrl(publicUrl);
      onUploaded(publicUrl);
    } catch (err) {
      URL.revokeObjectURL(localPreview);
      localPreviewRef.current = null;
      setPreviewUrl(null);
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

  const displayUrl = previewUrl ?? currentUrl;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {presentation === "full-body" ? (
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
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="min-h-11 rounded-lg px-3 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
      >
        {uploading ? "Uploading..." : presentation === "full-body" ? "Change full-body reference" : "Change portrait"}
      </button>

      {error && <p role="alert" className="text-red-400 text-xs text-center max-w-48">{error}</p>}
    </div>
  );
}
