export async function currentPrivyProof(
  getAccessToken: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
}
