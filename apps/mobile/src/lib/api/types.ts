export type DesktopMode = "lan" | "remote";

export interface MobileServerStatus {
  state: string;
  desktopId: string;
  desktopName: string;
  lanHost: string;
  lanPort: number;
  pairingCode: string | null;
}

export interface DesktopDescriptor {
  id: string;
  name: string;
  connectionMode: string;
}

export interface DesktopSummary {
  id: string;
  name: string;
  online: boolean;
  mode: DesktopMode;
}

export interface PairingSession {
  code: string;
  desktopId: string;
  desktopName: string;
  lanHost: string;
  lanPort: number;
  expiresAtUnixMs: number;
}

export interface TaskSummary {
  id: string;
  repoId: string;
  title: string;
  stage: string | null;
}
