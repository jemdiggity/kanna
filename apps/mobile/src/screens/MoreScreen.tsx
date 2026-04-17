import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";

interface MoreScreenProps {
  pairingCode: string | null;
  selectedTask: TaskSummary | null;
  onRefresh(): void;
  onShowDesktops(): void;
  onStartPairing(): void;
  onOpenComposer(): void;
}

export function MoreScreen({
  pairingCode,
  selectedTask,
  onRefresh,
  onShowDesktops,
  onStartPairing,
  onOpenComposer
}: MoreScreenProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>More</Text>
      <Text style={styles.subheading}>
        Command palette actions for desktop selection, refresh, pairing, and task management.
      </Text>

      <View style={styles.commandCard}>
        <Text style={styles.commandLabel}>Active pairing code</Text>
        <Text style={styles.commandValue}>{pairingCode ?? "No pairing session"}</Text>
      </View>

      <Pressable style={styles.action} onPress={onRefresh}>
        <Text style={styles.actionTitle}>Refresh Data</Text>
        <Text style={styles.actionCopy}>Reload desktops, repos, and recent tasks.</Text>
      </Pressable>

      <Pressable style={styles.action} onPress={onStartPairing}>
        <Text style={styles.actionTitle}>Start Pairing</Text>
        <Text style={styles.actionCopy}>Generate a fresh LAN pairing code.</Text>
      </Pressable>

      <Pressable style={styles.action} onPress={onShowDesktops}>
        <Text style={styles.actionTitle}>Switch Desktop</Text>
        <Text style={styles.actionCopy}>Jump to the desktop picker.</Text>
      </Pressable>

      <Pressable style={styles.action} onPress={onOpenComposer}>
        <Text style={styles.actionTitle}>Create Task</Text>
        <Text style={styles.actionCopy}>Open the new-task composer.</Text>
      </Pressable>

      <View style={styles.commandCard}>
        <Text style={styles.commandLabel}>Selected task</Text>
        <Text style={styles.commandValue}>
          {selectedTask ? selectedTask.title : "No task selected"}
        </Text>
        <Text style={styles.commandHint}>
          Stage advance and merge-agent commands will land once the mobile session API exposes them.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14
  },
  heading: {
    color: "#F5F7FB",
    fontSize: 24,
    fontWeight: "700"
  },
  subheading: {
    color: "#A9B8D1",
    fontSize: 14,
    lineHeight: 20
  },
  commandCard: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  commandLabel: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  commandValue: {
    color: "#F5F7FB",
    fontSize: 18,
    fontWeight: "700"
  },
  commandHint: {
    color: "#93A7C8",
    fontSize: 13,
    lineHeight: 19
  },
  action: {
    backgroundColor: "#111B2C",
    borderColor: "#20304C",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16
  },
  actionTitle: {
    color: "#F5F7FB",
    fontSize: 16,
    fontWeight: "700"
  },
  actionCopy: {
    color: "#B4C2D8",
    fontSize: 14,
    lineHeight: 20
  }
});
