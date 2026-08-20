interface ListeningServer {
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}

/**
 * Claim the process listener before starting any background runtime that can
 * mutate durable ownership. A competing process must fail at listen time
 * without classifying or recovering another process's healthy game runner.
 */
export async function listenBeforeRuntimeInitialization<TServer extends ListeningServer>(
  options: {
    listen(): TServer;
    initializeRuntime(): Promise<void>;
    onListening?(server: TServer): void | Promise<void>;
    onReady?(server: TServer): void | Promise<void>;
  },
): Promise<TServer> {
  const server = options.listen();
  try {
    await options.onListening?.(server);
    await options.initializeRuntime();
    await options.onReady?.(server);
    return server;
  } catch (startupError) {
    try {
      await server.stop(true);
    } catch (cleanupError) {
      throw new AggregateError(
        [startupError, cleanupError],
        "Runtime initialization failed and the listener could not be closed",
      );
    }
    throw startupError;
  }
}
