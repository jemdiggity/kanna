export type TabName = "Desktops" | "Tasks" | "Recent";

export interface TabRoute {
  name: TabName;
  label: string;
}

export interface RootNavigatorModel {
  initialRouteName: TabName;
  tabs: TabRoute[];
}

export function createRootNavigator(): RootNavigatorModel {
  return {
    initialRouteName: "Desktops",
    tabs: [
      { name: "Desktops", label: "Desktops" },
      { name: "Tasks", label: "Tasks" },
      { name: "Recent", label: "Recent" }
    ]
  };
}

export default function RootNavigator(): RootNavigatorModel {
  return createRootNavigator();
}
