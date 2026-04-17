import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DesktopSummary } from "../lib/api/types";

interface DesktopsScreenProps {
  desktops: DesktopSummary[];
  selectedDesktopId: string | null;
  onSelectDesktop(desktopId: string): void;
}

export function DesktopsScreen({
  desktops,
  selectedDesktopId,
  onSelectDesktop
}: DesktopsScreenProps) {
  return (
    <View style={styles.list}>
      {desktops.map((desktop) => {
        const selected = desktop.id === selectedDesktopId;
        return (
          <Pressable
            key={desktop.id}
            style={[styles.card, selected ? styles.cardSelected : null]}
            onPress={() => onSelectDesktop(desktop.id)}
          >
            <View style={styles.row}>
              <Text style={styles.title}>{desktop.name}</Text>
              <View style={styles.modePill}>
                <Text style={styles.modeLabel}>{desktop.mode}</Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {desktop.online ? "Available on this network" : "Remote desktop is offline"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12
  },
  card: {
    backgroundColor: "#111B2C",
    borderColor: "#20304C",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  cardSelected: {
    borderColor: "#E8F1FF",
    shadowColor: "#9BBEFF",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 18
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  title: {
    color: "#F5F7FB",
    fontSize: 16,
    fontWeight: "700"
  },
  modePill: {
    backgroundColor: "#172843",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  modeLabel: {
    color: "#9EB6DC",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  meta: {
    color: "#B4C2D8",
    fontSize: 14
  }
});
