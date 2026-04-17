import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";

interface TaskCardProps {
  task: TaskSummary;
  onPress(): void;
}

export function TaskCard({ task, onPress }: TaskCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <Text style={styles.title}>{task.title}</Text>
        <View style={styles.stagePill}>
          <Text style={styles.stageLabel}>{task.stage ?? "unknown"}</Text>
        </View>
      </View>
      <Text style={styles.meta}>Repo {task.repoId}</Text>
      <Text style={styles.preview}>
        {task.snippet?.trim()
          ? task.snippet
          : task.stage === "pr"
            ? "Ready for review from mobile."
            : "Latest desktop activity is available in the task detail view."}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#111B2C",
    borderColor: "#20304C",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  title: {
    color: "#F3F7FF",
    flex: 1,
    fontSize: 16,
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
    color: "#7E93B4",
    fontSize: 12,
    fontWeight: "600"
  },
  preview: {
    color: "#B8C6DB",
    fontSize: 14,
    lineHeight: 20
  }
});
