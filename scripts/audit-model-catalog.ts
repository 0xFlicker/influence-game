import { providerModelInventory } from "../packages/api/src/routes/provider-models";

// Explicit, read-only provider discovery. Never sends inference requests.
const inventory = await providerModelInventory(process.env, true);
let gaps = 0;
for (const provider of inventory.providers) {
  if (provider.status === "unavailable") {
    console.error(`${provider.displayName}: catalog unavailable; not audited`);
    continue;
  }
  const models = inventory.models.filter(model => model.providerProfileId === provider.providerProfileId && model.available);
  console.log(`${provider.displayName}: ${models.length} selectable models`);
  for (const model of models) {
    const missing = [!model.metadata.rateCard && "pricing", model.capabilityEvidence !== "documented" && "documented capabilities"].filter(Boolean);
    if (missing.length) {
      gaps++;
      console.error(`  ${model.catalogId}: missing ${missing.join(" and ")}`);
    }
  }
}
if (!inventory.providers.length) throw new Error("No providers configured; supply the normal provider environment.");
console.log(`${gaps} metadata gaps in available catalogs. No inference requests made.`);
process.exitCode = gaps ? 1 : inventory.providers.every(provider => provider.status === "unavailable") ? 2 : 0;
