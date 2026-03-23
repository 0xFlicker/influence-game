import type { Context } from "hono";

/**
 * Safely parse the JSON body from a Hono request context.
 * On parse failure, logs the error with route context and returns null.
 */
export async function parseJsonBody(
  c: Context,
  routeName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  try {
    return await c.req.json();
  } catch (err) {
    console.warn(
      `[${routeName}] JSON body parse failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
