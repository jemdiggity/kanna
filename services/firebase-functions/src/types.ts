export const emulatorPorts = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
} as const;

export interface PairingCodeRecord {
  desktopId: string;
  desktopDisplayName: string;
  desktopClaimTokenHash: string;
  desktopNonce: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "claimed" | "expired" | "cancelled";
  claimedByUid: string | null;
  claimedAt: string | null;
}
