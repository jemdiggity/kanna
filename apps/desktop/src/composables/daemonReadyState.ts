let daemonReadyObserved = false;

export function markDaemonReadyObserved(): void {
  daemonReadyObserved = true;
}

export function hasObservedDaemonReady(): boolean {
  return daemonReadyObserved;
}

export function resetDaemonReadyObservationForTests(): void {
  daemonReadyObserved = false;
}
