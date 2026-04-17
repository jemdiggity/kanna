import { describe, expect, it } from "vitest";
import { WebDriverClient } from "./webdriver";
import { getSecondaryWebDriverPort, getWebDriverBaseUrl, getWebDriverPort } from "./webdriverPort";

describe("webdriverPort", () => {
  it("defaults to the primary webdriver port", () => {
    const previous = process.env.KANNA_WEBDRIVER_PORT;
    delete process.env.KANNA_WEBDRIVER_PORT;

    expect(getWebDriverPort()).toBe(4445);
    expect(getWebDriverBaseUrl()).toBe("http://127.0.0.1:4445");

    if (previous === undefined) delete process.env.KANNA_WEBDRIVER_PORT;
    else process.env.KANNA_WEBDRIVER_PORT = previous;
  });

  it("reads an explicit primary webdriver port", () => {
    const previous = process.env.KANNA_WEBDRIVER_PORT;
    process.env.KANNA_WEBDRIVER_PORT = "4550";

    expect(getWebDriverPort()).toBe(4550);
    expect(getWebDriverBaseUrl()).toBe("http://127.0.0.1:4550");

    if (previous === undefined) delete process.env.KANNA_WEBDRIVER_PORT;
    else process.env.KANNA_WEBDRIVER_PORT = previous;
  });

  it("derives the secondary webdriver port from the explicit target env var", () => {
    const previous = process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT;
    process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT = "4446";

    expect(getSecondaryWebDriverPort()).toBe(4446);

    if (previous === undefined) delete process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT;
    else process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT = previous;
  });

  it("keeps the primary and secondary webdriver ports in one place", () => {
    const previousPrimary = process.env.KANNA_WEBDRIVER_PORT;
    const previousSecondary = process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT;
    const previousDevPort = process.env.KANNA_DEV_PORT;
    const previousTauriPort = process.env.TAURI_WEBDRIVER_PORT;

    process.env.KANNA_WEBDRIVER_PORT = "4550";
    process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT = "4551";
    delete process.env.KANNA_DEV_PORT;
    delete process.env.TAURI_WEBDRIVER_PORT;

    const primaryClient = new WebDriverClient();
    const secondaryClient = new WebDriverClient(getSecondaryWebDriverPort());

    expect(getWebDriverPort()).toBe(4550);
    expect(getSecondaryWebDriverPort()).toBe(4551);
    expect(getWebDriverBaseUrl()).toBe("http://127.0.0.1:4550");
    expect(primaryClient.getBaseUrl()).toBe("http://127.0.0.1:4550");
    expect(secondaryClient.getBaseUrl()).toBe("http://127.0.0.1:4551");

    if (previousPrimary === undefined) delete process.env.KANNA_WEBDRIVER_PORT;
    else process.env.KANNA_WEBDRIVER_PORT = previousPrimary;
    if (previousSecondary === undefined) delete process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT;
    else process.env.KANNA_E2E_TARGET_WEBDRIVER_PORT = previousSecondary;
    if (previousDevPort === undefined) delete process.env.KANNA_DEV_PORT;
    else process.env.KANNA_DEV_PORT = previousDevPort;
    if (previousTauriPort === undefined) delete process.env.TAURI_WEBDRIVER_PORT;
    else process.env.TAURI_WEBDRIVER_PORT = previousTauriPort;
  });
});
