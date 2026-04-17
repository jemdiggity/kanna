import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";

interface TaskScreenProps {
  desktopName: string | null;
  task: TaskSummary;
  onBack(): void;
}

export function TaskScreen({ desktopName, task, onBack }: TaskScreenProps) {
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <Text style={styles.backLabel}>Back to Tasks</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>{task.title}</Text>
        <View style={styles.stagePill}>
          <Text style={styles.stageLabel}>{task.stage ?? "unknown"}</Text>
        </View>
      </View>

      <Text style={styles.meta}>Repo {task.repoId}</Text>

      <View style={styles.terminalCard}>
        <Text style={styles.terminalLine}>{`> desktop: ${desktopName ?? "Unknown desktop"}`}</Text>
        <Text style={styles.terminalLine}>{`> task: ${task.title}`}</Text>
        <Text style={styles.terminalLine}>{`> stage: ${task.stage ?? "unknown"}`}</Text>
        <Text style={styles.terminalHint}>
          Live terminal streaming is the next API slice. This view already behaves like the
          channel/task detail surface and will slot the stream in once the session endpoint lands.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14
  },
  backButton: {
    alignSelf: "flex-start",
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  backLabel: {
    color: "#D5DEEC",
    fontSize: 13,
    fontWeight: "700"
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  title: {
    color: "#F5F7FB",
    flex: 1,
    fontSize: 24,
    fontWeight: "700"
  },
  stagePill: {
    backgroundColor: "#172843",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  stageLabel: {
    color: "#9EB6DC",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  meta: {
    color: "#8EA3C4",
    fontSize: 13,
    fontWeight: "600"
  },
  terminalCard: {
    backgroundColor: "#08111E",
    borderColor: "#20304C",
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    minHeight: 280,
    padding: 18
  },
  terminalLine: {
    color: "#B9D4FF",
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 18
  },
  terminalHint: {
    color: "#95A9C8",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10
  }
});
