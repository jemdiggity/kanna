export interface PortAllocationLogEntry {
  envName: string;
  requestedPort: number;
  assignedPort: number;
  reusedExisting: boolean;
}

export function formatTaskPortAllocationLog(
  itemId: string,
  entries: PortAllocationLogEntry[],
): string {
  const details = entries
    .map(({ envName, requestedPort, assignedPort, reusedExisting }) =>
      `${envName} requested=${requestedPort} assigned=${assignedPort} reused=${reusedExisting}`,
    )
    .join(", ");

  return `[store] task ports reserved: item=${itemId} ${details}`;
}
