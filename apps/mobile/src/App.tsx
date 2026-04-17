import React, { useRef } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { createAppModel, type AppModel } from "./appModel";

export default function App() {
  const modelRef = useRef<AppModel | null>(null);
  if (!modelRef.current) {
    modelRef.current = createAppModel();
  }

  const model = modelRef.current;
  const state = model.sessionStore.getState();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <Text style={styles.eyebrow}>Kanna Mobile</Text>
        <Text style={styles.title}>Desktop Pairing</Text>
        <Text style={styles.copy}>
          Connect to a desktop daemon over the local network first, then switch
          between paired desktops from the task surfaces below.
        </Text>

        <View style={styles.actions}>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryLabel}>Connect on Local Network</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryLabel}>Sign In for Remote Access</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Tabs</Text>
          <View style={styles.tabRow}>
            {model.navigator.tabs.map((tab) => (
              <View key={tab.name} style={styles.tabPill}>
                <Text style={styles.tabLabel}>{tab.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Selected Desktop</Text>
          <Text style={styles.sectionValue}>
            {state.selectedDesktopId ?? "No desktop selected yet"}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0B1220"
  },
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 28,
    gap: 18
  },
  eyebrow: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  title: {
    color: "#F5F7FB",
    fontSize: 32,
    fontWeight: "700"
  },
  copy: {
    color: "#B5C0D4",
    fontSize: 15,
    lineHeight: 22
  },
  actions: {
    gap: 10
  },
  primaryButton: {
    backgroundColor: "#E8F1FF",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  primaryLabel: {
    color: "#0B1220",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },
  secondaryButton: {
    backgroundColor: "#152036",
    borderColor: "#22304D",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  secondaryLabel: {
    color: "#D5DEEC",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center"
  },
  section: {
    backgroundColor: "#10192A",
    borderColor: "#22304D",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16
  },
  sectionLabel: {
    color: "#7FA7D9",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  sectionValue: {
    color: "#F5F7FB",
    fontSize: 16,
    fontWeight: "600"
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  tabPill: {
    backgroundColor: "#17243B",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  tabLabel: {
    color: "#DCE6F5",
    fontSize: 13,
    fontWeight: "600"
  }
});
