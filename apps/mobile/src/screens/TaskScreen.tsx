import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";
import { buildTaskWorkspaceModel } from "./taskWorkspace";

interface TaskScreenProps {
  desktopName: string | null;
  repoName: string | null;
  task: TaskSummary;
  onBack(): void;
  onOpenMore(): void;
  onShowSearch(): void;
}

export function TaskScreen({
  desktopName,
  repoName,
  task,
  onBack,
  onOpenMore,
  onShowSearch
}: TaskScreenProps) {
  const model = buildTaskWorkspaceModel({ desktopName, repoName, task });

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

      <Text style={styles.meta}>{repoName ?? `Repo ${task.repoId}`}</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>{model.summaryLabel}</Text>
        <Text style={styles.summaryCopy}>{model.summaryCopy}</Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.actionButtonPrimary} onPress={onOpenMore}>
          <Text style={styles.actionButtonPrimaryLabel}>{model.primaryActionLabel}</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onShowSearch}>
          <Text style={styles.actionButtonLabel}>Search Tasks</Text>
        </Pressable>
      </View>

      <View style={styles.factsGrid}>
        {model.facts.map((fact) => (
          <View key={fact.label} style={styles.factCard}>
            <Text style={styles.factLabel}>{fact.label}</Text>
            <Text style={styles.factValue}>{fact.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.terminalCard}>
        {model.terminalLines.map((line) => (
          <Text key={line} style={styles.terminalLine}>
            {`> ${line}`}
          </Text>
        ))}
        <Text style={styles.terminalHint}>
          Live terminal streaming is the next API slice. Until that lands, this screen keeps the
          selected task, its current stage, and the fastest mobile actions in one place.
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
  summaryCard: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  summaryLabel: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  summaryCopy: {
    color: "#E6EDF8",
    fontSize: 15,
    lineHeight: 22
  },
  actionRow: {
    flexDirection: "row",
    gap: 10
  },
  actionButton: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  actionButtonPrimary: {
    backgroundColor: "#E8F1FF",
    borderRadius: 999,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  actionButtonLabel: {
    color: "#D5DEEC",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  actionButtonPrimaryLabel: {
    color: "#0B1220",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  factsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  factCard: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    minWidth: "47%",
    padding: 14
  },
  factLabel: {
    color: "#7FA7D9",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  factValue: {
    color: "#F5F7FB",
    fontSize: 15,
    fontWeight: "700"
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
