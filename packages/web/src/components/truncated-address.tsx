"use client";

/**
 * Renders a full wallet address with CSS text-overflow truncation.
 * The full address stays in the DOM so it can be selected and copied.
 */
export function TruncatedAddress({
  address,
  className = "",
  maxWidth = "9ch",
}: {
  address: string;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <span
      className={`inline-block overflow-hidden text-ellipsis whitespace-nowrap align-bottom ${className}`}
      style={{ maxWidth }}
      title={address}
    >
      {address}
    </span>
  );
}
