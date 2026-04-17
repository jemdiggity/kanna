export type TabName = "tasks" | "recent" | "desktops" | "more";

export interface TabRoute {
  name: TabName;
  label: string;
}

export interface UtilityAction {
  name: "search" | "create";
  label: string;
}

export interface RootNavigatorModel {
  initialRouteName: TabName;
  tabs: TabRoute[];
  utilityActions: UtilityAction[];
}

export function createRootNavigator(): RootNavigatorModel {
  return {
    initialRouteName: "tasks",
    tabs: [
      { name: "tasks", label: "Tasks" },
      { name: "recent", label: "Recent" },
      { name: "desktops", label: "Desktops" },
      { name: "more", label: "More" }
    ],
    utilityActions: [
      { name: "search", label: "Search" },
      { name: "create", label: "New Task" }
    ]
  };
}

export default function RootNavigator(): RootNavigatorModel {
  return createRootNavigator();
}
