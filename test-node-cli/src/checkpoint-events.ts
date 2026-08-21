interface CheckpointEvent {
  type: string;
  error?: string;
}

/**
 * Print every checkpoint/restore event and reject when the stream's terminal
 * event reports an operation failure. Error events may be advisory when more
 * events follow, so only the final event determines the operation result.
 */
export async function consumeCheckpointEvents(
  stream: AsyncIterable<CheckpointEvent>,
  write: (event: CheckpointEvent) => void = event => console.log(JSON.stringify(event)),
): Promise<void> {
  let lastEvent: CheckpointEvent | undefined;

  for await (const event of stream) {
    write(event);
    lastEvent = event;
  }

  if (lastEvent?.type === 'error') {
    throw new Error(lastEvent.error || 'Checkpoint operation failed');
  }
}
