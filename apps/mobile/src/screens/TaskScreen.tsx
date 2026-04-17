import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";
import type { TaskTerminalStatus } from "../state/sessionStore";
import { buildTaskWorkspaceModel } from "./taskWorkspace";

interface TaskScreenProps {
  desktopName: string | null;
  repoName: string | null;
  task: TaskSummary;
  terminalOutput: string;
  terminalStatus: TaskTerminalStatus;
  onBack(): void;
  onOpenMore(): void;
  onShowSearch(): void;
  onSendInput(input: string): void;
}

export function TaskScreen({
  desktopName,
  repoName,
  task,
  terminalOutput,
  terminalStatus,
  onBack,
  onOpenMore,
  onShowSearch,
  onSendInput
}: TaskScreenProps) {
  const model = buildTaskWorkspaceModel({ desktopName, repoName, task });
  const [draftInput, setDraftInput] = useState("");
  const terminalText =
    terminalOutput.trim() ||
    (terminalStatus === "connecting"
      ? "Connecting to desktop daemon..."
      : "Waiting for terminal output...");

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backLabel}>Tasks</Text>
        </Pressable>
        <Pressable style={styles.topActionButton} onPress={onShowSearch}>
          <Text style={styles.topActionLabel}>Search</Text>
        </Pressable>
      </View>

      <View style={styles.channelCard}>
        <View style={styles.header}>
          <Text style={styles.title}>{task.title}</Text>
          <View style={styles.stagePill}>
            <Text style={styles.stageLabel}>{task.stage ?? "unknown"}</Text>
          </View>
        </View>

        <Text style={styles.meta}>{repoName ?? `Repo ${task.repoId}`}</Text>
        <Text style={styles.summaryCopy}>{model.summaryCopy}</Text>

        <View style={styles.contextRow}>
          {model.facts.map((fact) => (
            <View key={fact.label} style={styles.contextPill}>
              <Text style={styles.contextLabel}>{fact.label}</Text>
              <Text style={styles.contextValue}>{fact.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.terminalCard}>
        <View style={styles.terminalHeader}>
          <View style={styles.terminalHeaderCopy}>
            <Text style={styles.terminalLabel}>Agent Terminal</Text>
            <Text style={styles.terminalSubhead}>{model.summaryLabel}</Text>
          </View>
          <View style={styles.terminalHeaderActions}>
            <View style={styles.terminalStatusPill}>
              <Text style={styles.terminalStatusLabel}>{terminalStatus}</Text>
            </View>
            <Pressable style={styles.actionButtonPrimary} onPress={onOpenMore}>
              <Text style={styles.actionButtonPrimaryLabel}>{model.primaryActionLabel}</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.terminalOutput}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.terminalViewport}
        >
          <Text style={styles.terminalLine}>{terminalText}</Text>
        </ScrollView>

        <Text style={styles.terminalHint}>
          This stays attached to the selected desktop task. Use More for task actions while the
          stream remains live.
        </Text>
        <View style={styles.inputComposer}>
          <TextInput
            onChangeText={setDraftInput}
            placeholder="Send input to the agent"
            placeholderTextColor="#6F89AE"
            style={styles.inputField}
            value={draftInput}
          />
          <Pressable
            style={styles.sendButton}
            onPress={() => {
              const nextInput = draftInput.trim();
              if (!nextInput) {
                return;
              }

              onSendInput(nextInput);
              setDraftInput("");
            }}
          >
            <Text style={styles.sendButtonLabel}>Send</Text>
          </Pressable>
        </View>
        {model.terminalLines.map((line) => (
          <Text key={line} style={styles.terminalMetaLine}>
            {`> ${line}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14
  },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
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
  topActionButton: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  topActionLabel: {
    color: "#D5DEEC",
    fontSize: 13,
    fontWeight: "700"
  },
  channelCard: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    padding: 18
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
  summaryCopy: {
    color: "#E6EDF8",
    fontSize: 15,
    lineHeight: 22
  },
  contextRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  contextPill: {
    backgroundColor: "#111B2C",
    borderColor: "#20304C",
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  contextLabel: {
    color: "#7FA7D9",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  contextValue: {
    color: "#F5F7FB",
    fontSize: 13,
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
  terminalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  terminalHeaderCopy: {
    gap: 4
  },
  terminalLabel: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  terminalSubhead: {
    color: "#F5F7FB",
    fontSize: 16,
    fontWeight: "700"
  },
  terminalHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  terminalStatusPill: {
    backgroundColor: "#172843",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  terminalStatusLabel: {
    color: "#9EB6DC",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  actionButtonPrimary: {
    backgroundColor: "#E8F1FF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  actionButtonPrimaryLabel: {
    color: "#0B1220",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  terminalViewport: {
    backgroundColor: "#050B14",
    borderColor: "#15243C",
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: 280
  },
  terminalOutput: {
    minHeight: 220,
    padding: 14
  },
  terminalLine: {
    color: "#B9D4FF",
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 18
  },
  terminalMetaLine: {
    color: "#6F89AE",
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 17
  },
  terminalHint: {
    color: "#95A9C8",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 2
  },
  inputComposer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  inputField: {
    backgroundColor: "#10192A",
    borderColor: "#20304C",
    borderRadius: 14,
    borderWidth: 1,
    color: "#F5F7FB",
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  sendButton: {
    backgroundColor: "#E8F1FF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  sendButtonLabel: {
    color: "#0B1220",
    fontSize: 13,
    fontWeight: "700"
  }
});
