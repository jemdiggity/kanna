import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";
import {
  buildMoreCommandPalette,
  buildMoreCommandSections,
  type MoreCommandAction
} from "./moreCommands";

interface MoreScreenProps {
  pairingCode: string | null;
  selectedTask: TaskSummary | null;
  onRefresh(): void;
  onShowDesktops(): void;
  onStartPairing(): void;
  onOpenComposer(): void;
  onAdvanceTaskStage(taskId: string): void;
  onRunMergeAgent(taskId: string): void;
  onCloseTask(taskId: string): void;
}

export function MoreScreen({
  pairingCode,
  selectedTask,
  onRefresh,
  onShowDesktops,
  onStartPairing,
  onOpenComposer,
  onAdvanceTaskStage,
  onRunMergeAgent,
  onCloseTask
}: MoreScreenProps) {
  const [query, setQuery] = useState("");
  const sections = buildMoreCommandSections({ pairingCode, selectedTask });
  const paletteEntries = useMemo(
    () => buildMoreCommandPalette({ pairingCode, selectedTask }, query),
    [pairingCode, query, selectedTask]
  );

  const handleAction = (action: MoreCommandAction) => {
    switch (action.id) {
      case "refresh":
        onRefresh();
        break;
      case "pair":
        onStartPairing();
        break;
      case "desktops":
        onShowDesktops();
        break;
      case "compose":
        onOpenComposer();
        break;
      case "advance-stage":
        if (selectedTask) {
          onAdvanceTaskStage(selectedTask.id);
        }
        break;
      case "merge-agent":
        if (selectedTask) {
          onRunMergeAgent(selectedTask.id);
        }
        break;
      case "close-task":
        if (selectedTask) {
          onCloseTask(selectedTask.id);
        }
        break;
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>More</Text>
      <Text style={styles.subheading}>
        Search commands for desktop selection, refresh, pairing, and task management.
      </Text>

      <View style={styles.paletteCard}>
        <TextInput
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Search commands"
          placeholderTextColor="#6A7E9D"
          style={styles.searchInput}
          value={query}
        />

        <View style={styles.paletteList}>
          {paletteEntries.length ? (
            paletteEntries.map((action) => (
              <Pressable
                key={action.id}
                style={styles.action}
                onPress={() => handleAction(action)}
              >
                <Text style={styles.commandLabel}>{action.sectionTitle}</Text>
                <Text style={styles.actionTitle}>{action.title}</Text>
                <Text style={styles.actionCopy}>{action.copy}</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No commands matched</Text>
              <Text style={styles.emptyCopy}>
                Try searching for merge, stage, pair, desktop, or task.
              </Text>
            </View>
          )}
        </View>
      </View>

      {sections
        .filter((section) => !section.actions?.length)
        .map((section) => (
        <View key={section.title} style={styles.commandCard}>
          <Text style={styles.commandLabel}>{section.title}</Text>
          <Text style={styles.commandValue}>{section.headline}</Text>
          <Text style={styles.commandHint}>{section.detail}</Text>
        </View>
        ))}
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
  paletteCard: {
    backgroundColor: "#0D1727",
    borderColor: "#22304D",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  searchInput: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 16,
    borderWidth: 1,
    color: "#F5F7FB",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  paletteList: {
    gap: 10
  },
  commandCard: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
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
  emptyState: {
    alignItems: "center",
    backgroundColor: "#10192A",
    borderColor: "#20304C",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 20
  },
  emptyTitle: {
    color: "#F5F7FB",
    fontSize: 15,
    fontWeight: "700"
  },
  emptyCopy: {
    color: "#93A7C8",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center"
  },
  action: {
    backgroundColor: "#111B2C",
    borderColor: "#20304C",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 14
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
