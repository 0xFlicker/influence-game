"use client";

import { useRef, useState } from "react";
import { requestUploadUrl } from "@/lib/api";
import { AgentAvatar } from "./agent-avatar";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

interface AvatarUploadProps {
  currentUrl?: string | null;
  persona: string;
  name: string;
  onUploaded: (publicUrl: string) => void;
}

export function AvatarUpload({ currentUrl, persona, name, onUploaded }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

    // Show local preview immediately
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);

    try {
      const { uploadUrl, publicUrl } = await requestUploadUrl(file.name, file.type);

      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      URL.revokeObjectURL(localPreview);
      setPreviewUrl(publicUrl);
      onUploaded(publicUrl);
    } catch (err) {
      URL.revokeObjectURL(localPreview);
      setPreviewUrl(null);
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  const displayUrl = previewUrl ?? currentUrl;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="relative group cursor-pointer disabled:cursor-wait"
      >
        <AgentAvatar avatarUrl={displayUrl} persona={persona} name={name} size="16" />

        {/* Hover overlay */}
        <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-[10px] font-medium">
            {uploading ? "Uploading..." : "Change"}
          </span>
        </div>

        {/* Loading spinner ring */}
        {uploading && (
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />

      {error && <p className="text-red-400 text-xs text-center max-w-48">{error}</p>}
    </div>
  );
}
