import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TabName, TabRoute } from "../navigation/RootNavigator";

interface FloatingToolbarProps {
  activeTab: TabName;
  tabs: TabRoute[];
  onSelectTab(tab: TabName): void;
}

export function FloatingToolbar({
  activeTab,
  tabs,
  onSelectTab
}: FloatingToolbarProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const active = tab.name === activeTab;
          return (
            <Pressable
              key={tab.name}
              style={[styles.item, active ? styles.itemActive : null]}
              onPress={() => onSelectTab(tab.name)}
            >
              <Text style={[styles.label, active ? styles.labelActive : null]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    bottom: 18,
    left: 20,
    position: "absolute",
    right: 20
  },
  bar: {
    alignItems: "center",
    backgroundColor: "rgba(10, 18, 32, 0.96)",
    borderColor: "#20304C",
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#02060E",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.36,
    shadowRadius: 24
  },
  item: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  itemActive: {
    backgroundColor: "#E8F1FF"
  },
  label: {
    color: "#8EA3C4",
    fontSize: 13,
    fontWeight: "700"
  },
  labelActive: {
    color: "#0B1220"
  }
});
