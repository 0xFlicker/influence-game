/** Keep the owning turn alive until every dispatched call has saved its result.
 * A failed sibling must not release ownership or clear durable bindings while
 * another provider is still returning evidence. Results retain input order.
 */
export async function drainProviderCalls<T>(calls: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls);
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map(result => {
    if (result.status !== "fulfilled") throw new Error("Provider batch was not drained");
    return result.value;
  });
}
