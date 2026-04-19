export const emulatorPorts = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
} as const;

export interface CreatePairingCodeRequest {
  desktopDisplayName: string;
}

export interface CreatePairingCodeResponse {
  pairingCode: string;
  pairingCodeId: string;
  desktopId: string;
  desktopSecret: string;
  desktopClaimToken: string;
  expiresAt: string;
}

export interface PairingCodeRecord {
  desktopId: string;
  desktopDisplayName: string;
  desktopClaimTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "claimed" | "expired" | "cancelled";
  claimedByUid: string | null;
  claimedAt: string | null;
}

export interface DesktopRecord {
  desktopId: string;
  displayName: string;
  desktopSecret: string;
  lastSeenAt: string | null;
  pairingCodeId: string;
  revokedAt: string | null;
}
