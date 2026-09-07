import { createDeploymentControlToken } from "../middleware/auth.js";

/** Host-only credential issuance; stdout must be captured, never logged. */
async function mintDeploymentControlToken(): Promise<string> {
  if (!process.env.JWT_SECRET?.trim()) {
    throw new Error("JWT_SECRET is required for deployment controller issuance");
  }
  // Lease acquisition requires five hours remaining. Renew on every deployment.
  return createDeploymentControlToken("6h");
}

if (import.meta.main) {
  try {
    console.log(await mintDeploymentControlToken());
  } catch {
    console.error("Deployment controller credential issuance failed; verify JWT_SECRET is configured.");
    process.exitCode = 1;
  }
}
