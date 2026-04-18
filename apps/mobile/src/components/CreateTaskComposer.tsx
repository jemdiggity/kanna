import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { RepoSummary } from "../lib/api/types";

interface CreateTaskComposerProps {
  isOpen: boolean;
  prompt: string;
  repos: RepoSummary[];
  selectedRepoId: string | null;
  onClose(): void;
  onSelectRepo(repoId: string): void;
  onChangePrompt(prompt: string): void;
  onSubmit(): void;
}

export function CreateTaskComposer({
  isOpen,
  prompt,
  repos,
  selectedRepoId,
  onClose,
  onSelectRepo,
  onChangePrompt,
  onSubmit
}: CreateTaskComposerProps) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={isOpen}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>New Task</Text>
          <Text style={styles.copy}>
            Pick a repo and enter the task prompt you want the desktop daemon to run.
          </Text>

          <ScrollView
            contentContainerStyle={styles.repoRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {repos.map((repo) => {
              const selected = repo.id === selectedRepoId;
              return (
                <Pressable
                  key={repo.id}
                  style={[styles.repoChip, selected ? styles.repoChipSelected : null]}
                  onPress={() => onSelectRepo(repo.id)}
                >
                  <Text
                    style={[
                      styles.repoChipLabel,
                      selected ? styles.repoChipLabelSelected : null
                    ]}
                  >
                    {repo.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            multiline
            onChangeText={onChangePrompt}
            placeholder="Describe the task for this repo"
            placeholderTextColor="#6A7E9D"
            style={styles.input}
            value={prompt}
          />

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryLabel}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={onSubmit}>
              <Text style={styles.primaryLabel}>Create Task</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "rgba(1, 5, 12, 0.58)",
    flex: 1,
    justifyContent: "flex-end"
  },
  sheet: {
    backgroundColor: "#0E1728",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 16,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 20
  },
  title: {
    color: "#F5F7FB",
    fontSize: 24,
    fontWeight: "700"
  },
  copy: {
    color: "#A9B8D1",
    fontSize: 14,
    lineHeight: 21
  },
  repoRow: {
    gap: 10,
    paddingVertical: 4
  },
  repoChip: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  repoChipSelected: {
    backgroundColor: "#E8F1FF",
    borderColor: "#E8F1FF"
  },
  repoChipLabel: {
    color: "#D5DEEC",
    fontSize: 13,
    fontWeight: "700"
  },
  repoChipLabelSelected: {
    color: "#0B1220"
  },
  input: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    color: "#F5F7FB",
    fontSize: 15,
    minHeight: 160,
    padding: 16,
    textAlignVertical: "top"
  },
  actions: {
    flexDirection: "row",
    gap: 10
  },
  secondaryButton: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14
  },
  primaryButton: {
    backgroundColor: "#E8F1FF",
    borderRadius: 16,
    flex: 1,
    paddingVertical: 14
  },
  secondaryLabel: {
    color: "#D5DEEC",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },
  primaryLabel: {
    color: "#0B1220",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  }
});
