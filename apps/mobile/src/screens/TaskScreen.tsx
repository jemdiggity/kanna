import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TaskSummary } from "../lib/api/types";
import type { TaskTerminalStatus } from "../state/sessionStore";
import { TerminalWebView } from "./TerminalWebView";
import { buildTaskWorkspaceModel } from "./taskWorkspace";

interface TaskScreenProps {
  task: TaskSummary;
  terminalOutput: string;
  terminalStatus: TaskTerminalStatus;
  onBack(): void;
  onOpenMore(): void;
  onSendInput(input: string): void;
}

export function TaskScreen({
  task,
  terminalOutput,
  terminalStatus,
  onBack,
  onOpenMore,
  onSendInput
}: TaskScreenProps) {
  const model = buildTaskWorkspaceModel({ task, terminalStatus });
  const [draftInput, setDraftInput] = useState("");
  const sendDisabled = model.isComposerDisabled || !draftInput.trim();

  return (
    <View style={styles.screen}>
      <View style={styles.terminalCanvas}>
        {model.isTerminalHealthy ? (
          <TerminalWebView fullscreen output={terminalOutput} status={terminalStatus} />
        ) : (
          <View style={styles.terminalSkeleton}>
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineMid} />
            <View style={styles.skeletonLineShort} />
            {model.overlayLabel ? (
              <View style={styles.terminalOverlay}>
                <Text style={styles.terminalOverlayLabel}>{model.overlayLabel}</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.topChrome}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backLabel}>{"<"}</Text>
        </Pressable>
        <View style={styles.titleChip}>
          <Text style={styles.stageLabel}>{model.stageLabel}</Text>
          <Text numberOfLines={1} style={styles.title}>
            {model.title}
          </Text>
        </View>
      </View>

      <View style={styles.bottomChrome}>
        <View style={styles.composerActions}>
          <Pressable style={styles.plusButton} onPress={onOpenMore}>
            <Text style={styles.plusButtonLabel}>+</Text>
          </Pressable>
        </View>

        <View style={styles.inputComposer}>
          <TextInput
            editable={!model.isComposerDisabled}
            onChangeText={setDraftInput}
            placeholder="Reply…"
            placeholderTextColor="#6F89AE"
            style={[styles.inputField, model.isComposerDisabled ? styles.inputFieldDisabled : null]}
            value={draftInput}
          />
          <Pressable
            disabled={sendDisabled}
            style={[styles.sendButton, sendDisabled ? styles.sendButtonDisabled : null]}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#040811",
    flex: 1,
    position: "relative"
  },
  terminalCanvas: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  terminalSkeleton: {
    backgroundColor: "#050B14",
    gap: 14,
    justifyContent: "center",
    minHeight: 680,
    paddingHorizontal: 18,
    paddingVertical: 120,
    position: "relative"
  },
  skeletonLineWide: {
    backgroundColor: "#101A29",
    borderRadius: 999,
    height: 10,
    width: "88%"
  },
  skeletonLineMid: {
    backgroundColor: "#101A29",
    borderRadius: 999,
    height: 10,
    width: "62%"
  },
  skeletonLineShort: {
    backgroundColor: "#101A29",
    borderRadius: 999,
    height: 10,
    width: "46%"
  },
  terminalOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  terminalOverlayLabel: {
    backgroundColor: "rgba(8, 17, 30, 0.92)",
    borderColor: "#2A4267",
    borderRadius: 999,
    borderWidth: 1,
    color: "#E6EDF8",
    fontSize: 13,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  topChrome: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    left: 14,
    position: "absolute",
    right: 14,
    top: 16,
    zIndex: 3
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(13, 21, 36, 0.78)",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  backLabel: {
    color: "#D5DEEC",
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 19
  },
  titleChip: {
    alignItems: "center",
    backgroundColor: "rgba(13, 21, 36, 0.78)",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  stageLabel: {
    color: "#7FA7D9",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    maxWidth: 96,
    textTransform: "uppercase"
  },
  title: {
    color: "#F5F7FB",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 17
  },
  bottomChrome: {
    bottom: 14,
    left: 14,
    position: "absolute",
    right: 14,
    zIndex: 3
  },
  composerActions: {
    alignItems: "flex-end",
    marginBottom: 8
  },
  plusButton: {
    alignItems: "center",
    backgroundColor: "rgba(13, 21, 36, 0.82)",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  plusButtonLabel: {
    color: "#E8F1FF",
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 22
  },
  inputComposer: {
    alignItems: "center",
    backgroundColor: "rgba(8, 15, 27, 0.88)",
    borderColor: "#20304C",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10
  },
  inputField: {
    color: "#F5F7FB",
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 8,
    paddingVertical: 10
  },
  inputFieldDisabled: {
    color: "#6F89AE",
    opacity: 0.65
  },
  sendButton: {
    backgroundColor: "#E8F1FF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  sendButtonDisabled: {
    opacity: 0.45
  },
  sendButtonLabel: {
    color: "#0B1220",
    fontSize: 13,
    fontWeight: "700"
  }
});
