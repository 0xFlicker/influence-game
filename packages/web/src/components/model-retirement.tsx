import { modelCatalogEntryById, type ResolvedModelCatalogEntry } from "@influence/engine/model-catalog";
import { isModelRetired } from "@influence/engine/model-route-metadata";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function modelRetirement(catalogId: string, metadata = modelCatalogEntryById(catalogId)?.metadata) {
  const facts = metadata?.documented;
  const retired = isModelRetired(facts);
  const notice = facts?.deprecation;
  if (!notice && !retired) return null;

  const status = retired ? "Retired" : "Retires";
  const date = notice ? dateFormat.format(new Date(notice.retirementDate)) : null;
  const replacementId = notice ? `${catalogId.split(":")[0]}:${notice.replacementModelId}` : null;
  const replacement = replacementId && (modelCatalogEntryById(replacementId)?.displayName ?? replacementId);
  return {
    retired,
    text: [
      date ? `${status} ${date} (UTC)` : status,
      replacement ? `Provider recommends ${replacement}${notice?.replacementRequirement ? ` (${notice.replacementRequirement})` : ""}` : null,
    ].filter(Boolean).join(" · "),
  };
}

export function ModelRetirement({ catalogId, metadata }: { catalogId: string; metadata?: ResolvedModelCatalogEntry["metadata"] }) {
  const retirement = modelRetirement(catalogId, metadata);
  if (!retirement) return null;
  return <span className="mt-2 block text-xs leading-5 text-amber-200">
    {retirement.text}{retirement.retired && " · Unavailable for new games"}
  </span>;
}
