import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RepoSummary, TaskSummary } from "../lib/api/types";
import { TaskList } from "../components/TaskList";

interface TasksScreenProps {
  heading: string;
  subheading: string;
  repos: RepoSummary[];
  selectedRepoId: string | null;
  tasks: TaskSummary[];
  onSelectRepo(repoId: string): void;
  onOpenTask(taskId: string): void;
}

export function TasksScreen({
  heading,
  subheading,
  repos,
  selectedRepoId,
  tasks,
  onSelectRepo,
  onOpenTask
}: TasksScreenProps) {
  const filteredTasks = selectedRepoId
    ? tasks.filter((task) => task.repoId === selectedRepoId)
    : tasks;
  const repoNameById = Object.fromEntries(repos.map((repo) => [repo.id, repo.name]));
  const isRecentView = heading === "Recent";

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.subheading}>{subheading}</Text>

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
                  styles.repoLabel,
                  selected ? styles.repoLabelSelected : null
                ]}
              >
                {repo.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <TaskList
        emptyLabel="No tasks for the selected repo yet."
        isRecentView={isRecentView}
        repoNameById={repoNameById}
        tasks={filteredTasks}
        onOpenTask={onOpenTask}
      />
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
  repoRow: {
    gap: 10,
    paddingVertical: 2
  },
  repoChip: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  repoChipSelected: {
    backgroundColor: "#E8F1FF"
  },
  repoLabel: {
    color: "#D5DEEC",
    fontSize: 13,
    fontWeight: "700"
  },
  repoLabelSelected: {
    color: "#0B1220"
  }
});
