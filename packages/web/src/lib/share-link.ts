export type ShareFeedback = {
  tone: "success" | "neutral" | "error";
  message: string;
};

function isShareCancellation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

export async function sharePostgameLink({
  href,
  origin,
  title,
  text,
  unavailableMessage,
  share,
  copy,
}: {
  href: string;
  origin: string;
  title: string;
  text: string;
  unavailableMessage: string;
  share?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<void>;
}): Promise<ShareFeedback> {
  const url = new URL(href, origin).toString();

  if (share) {
    try {
      await share({ title, text, url });
      return { tone: "success", message: "Share dialog opened." };
    } catch (error) {
      if (isShareCancellation(error)) {
        return { tone: "neutral", message: "Share cancelled." };
      }
      // Copying the canonical page is a useful fallback when native sharing fails.
    }
  }

  if (copy) {
    try {
      await copy(url);
      return { tone: "success", message: "Share link copied." };
    } catch {
      // The public player deliberately keeps platform errors out of the UI.
    }
  }

  return { tone: "error", message: unavailableMessage };
}

