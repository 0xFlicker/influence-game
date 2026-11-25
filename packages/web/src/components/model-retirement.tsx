import { modelCatalogEntryById, type ResolvedModelCatalogEntry } from "@influence/engine/model-catalog";
import { isHouseModelCutoffActive, isModelRetired, type HouseModelCutoff } from "@influence/engine/model-route-metadata";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function modelRetirement(catalogId: string, metadata = modelCatalogEntryById(catalogId)?.metadata, cutoff?: HouseModelCutoff) {
  const facts = metadata?.documented;
  const providerRetired = isModelRetired(facts);
  const houseRetired = isHouseModelCutoffActive(cutoff);
  const notice = facts?.deprecation;
  if (!notice && !providerRetired && !cutoff) return null;

  const status = providerRetired ? "Retired" : "Retires";
  const date = notice ? dateFormat.format(new Date(notice.retirementDate)) : null;
  const replacementId = notice ? `${catalogId.split(":")[0]}:${notice.replacementModelId}` : null;
  const replacement = replacementId && (modelCatalogEntryById(replacementId)?.displayName ?? replacementId);
  return {
    retired: providerRetired || houseRetired,
    text: [
      cutoff ? `House cutoff ${dateFormat.format(new Date(cutoff.cutoffDate))} (UTC) · House replacement ${modelCatalogEntryById(cutoff.replacementCatalogId)?.displayName ?? cutoff.replacementCatalogId}` : null,
      date ? `${status} ${date} (UTC)` : providerRetired ? status : null,
      replacement ? `Provider recommends ${replacement}${notice?.replacementRequirement ? ` (${notice.replacementRequirement})` : ""}` : null,
    ].filter(Boolean).join(" · "),
  };
}

export function ModelRetirement({ catalogId, metadata, cutoff }: { catalogId: string; metadata?: ResolvedModelCatalogEntry["metadata"]; cutoff?: HouseModelCutoff }) {
  const retirement = modelRetirement(catalogId, metadata, cutoff);
  if (!retirement) return null;
  return <span className="mt-2 block text-xs leading-5 text-amber-200">
    {retirement.text}{retirement.retired && " · Unavailable for new games"}
  </span>;
}
