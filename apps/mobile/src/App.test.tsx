import { expect, it } from "vitest";
import App from "./App";

it("renders the desktops tab label", () => {
  const app = App();

  expect(app.navigator.tabs.map((tab) => tab.label)).toContain("Desktops");
});
