/** Stops every CLI represented by one Agent Fleet sidebar row. */
export async function disconnectAgentSessionMembers(
  sessionIds: readonly string[],
  disconnect: (sessionId: string) => Promise<void>,
): Promise<void> {
  const outcomes = await Promise.allSettled(
    sessionIds.map((sessionId) => disconnect(sessionId)),
  );
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure) throw failure.reason;
}
