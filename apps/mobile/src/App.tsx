import { createRootNavigator } from "./navigation/RootNavigator";

export interface AppModel {
  navigator: ReturnType<typeof createRootNavigator>;
}

export default function App(): AppModel {
  return {
    navigator: createRootNavigator()
  };
}
