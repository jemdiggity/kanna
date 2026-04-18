import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ConnectionState } from "../state/sessionStore";

interface ConnectionScreenProps {
  connectionState: ConnectionState;
  desktopName: string | null;
  errorMessage: string | null;
  pairingCode: string | null;
  onConnectLocal(): void;
}

export function ConnectionScreen({
  connectionState,
  desktopName,
  errorMessage,
  pairingCode,
  onConnectLocal
}: ConnectionScreenProps) {
  const primaryLabel =
    connectionState === "connecting" ? "Connecting..." : "Connect on Local Network";

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>Kanna Mobile</Text>
      <Text style={styles.title}>Pair with a Desktop</Text>
      <Text style={styles.copy}>
        This iPhone app talks to the desktop-side daemon. Start with the local
        network path, then browse tasks and open them like channels.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Desktop</Text>
        <Text style={styles.cardValue}>{desktopName ?? "Not paired yet"}</Text>
        <Text style={styles.cardMeta}>
          {pairingCode ? `Pairing code ${pairingCode}` : "No active pairing session"}
        </Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorLabel}>{errorMessage}</Text>
        </View>
      ) : null}

      <Pressable style={styles.primaryButton} onPress={onConnectLocal}>
        <Text style={styles.primaryLabel}>{primaryLabel}</Text>
      </Pressable>

      <Pressable style={styles.secondaryButton}>
        <Text style={styles.secondaryLabel}>Remote Access Coming Next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 20
  },
  eyebrow: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  title: {
    color: "#F5F7FB",
    fontSize: 32,
    fontWeight: "700"
  },
  copy: {
    color: "#B5C0D4",
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    backgroundColor: "#10192A",
    borderColor: "#20304C",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18
  },
  cardLabel: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  cardValue: {
    color: "#F5F7FB",
    fontSize: 18,
    fontWeight: "700"
  },
  cardMeta: {
    color: "#9AAED0",
    fontSize: 14
  },
  errorCard: {
    backgroundColor: "rgba(97, 33, 36, 0.38)",
    borderColor: "rgba(214, 102, 114, 0.34)",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14
  },
  errorLabel: {
    color: "#FFC7CE",
    fontSize: 14,
    lineHeight: 20
  },
  primaryButton: {
    backgroundColor: "#E8F1FF",
    borderRadius: 16,
    paddingVertical: 16
  },
  primaryLabel: {
    color: "#0B1220",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },
  secondaryButton: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16
  },
  secondaryLabel: {
    color: "#D5DEEC",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  }
});
