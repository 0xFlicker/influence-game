"use client";

/**
 * Renders a wallet address with CSS middle-truncation (start…end).
 * The full address stays in the DOM split across two spans so it can be
 * selected and copy-pasted.
 */
export function TruncatedAddress({
  address,
  className = "",
  maxWidth = "11ch",
  tailChars = 4,
}: {
  address: string;
  className?: string;
  maxWidth?: string;
  tailChars?: number;
}) {
  const head = address.slice(0, -tailChars);
  const tail = address.slice(-tailChars);

  return (
    <span
      className={`inline-flex max-w-full align-bottom ${className}`}
      style={{ maxWidth }}
      title={address}
    >
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {head}
      </span>
      <span className="shrink-0 whitespace-nowrap">{tail}</span>
    </span>
  );
}
