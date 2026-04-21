/**
 * W3C WebDriver HTTP client for tauri-plugin-webdriver.
 */
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { APP_READY_SCRIPT } from "./appReady";
import { dismissStartupShortcutsModal } from "./startupOverlays";
import { getWebDriverPort } from "./webdriverPort";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export class WebDriverClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(port = getWebDriverPort()) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ── Session lifecycle ─────────────────────────────────────────────

  async createSession(): Promise<string> {
    const res = await this.post("/session", { capabilities: {} });
    this.sessionId = res.value.sessionId;
    await this.waitForAppReady();
    await dismissStartupShortcutsModal(this);
    return this.sessionId;
  }

  async deleteSession(): Promise<void> {
    if (!this.sessionId) return;
    await this.delete(`/session/${this.sessionId}`);
    this.sessionId = null;
  }

  // ── Element interaction ───────────────────────────────────────────

  async findElement(css: string): Promise<string> {
    const res = await this.post(`/session/${this.sid}/element`, {
      using: "css selector",
      value: css,
    });
    return res.value[ELEMENT_KEY];
  }

  async findElements(css: string): Promise<string[]> {
    const res = await this.post(`/session/${this.sid}/elements`, {
      using: "css selector",
      value: css,
    });
    return res.value.map((el: Record<string, string>) => el[ELEMENT_KEY]);
  }

  async click(elementId: string): Promise<void> {
    await this.post(`/session/${this.sid}/element/${elementId}/click`, {});
  }

  async getText(elementId: string): Promise<string> {
    const res = await this.get(`/session/${this.sid}/element/${elementId}/text`);
    return res.value;
  }

  async sendKeys(elementId: string, text: string): Promise<void> {
    await this.post(`/session/${this.sid}/element/${elementId}/value`, {
      text,
    });
  }

  async pressKey(value: string): Promise<void> {
    await this.post(`/session/${this.sid}/actions`, {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value },
            { type: "keyUp", value },
          ],
        },
      ],
    });
  }

  // ── JavaScript execution ──────────────────────────────────────────

  async executeSync<T = unknown>(
    script: string,
    args: unknown[] = []
  ): Promise<T> {
    const res = await this.post(`/session/${this.sid}/execute/sync`, {
      script,
      args,
    });
    return res.value as T;
  }

  async executeAsync<T = unknown>(
    script: string,
    args: unknown[] = []
  ): Promise<T> {
    const res = await this.post(`/session/${this.sid}/execute/async`, {
      script,
      args,
    });
    return res.value as T;
  }

  // ── Utilities ─────────────────────────────────────────────────────

  async getTitle(): Promise<string> {
    const res = await this.get(`/session/${this.sid}/title`);
    return res.value;
  }

  async screenshot(path?: string): Promise<string> {
    const res = await this.get(`/session/${this.sid}/screenshot`);
    const b64: string = res.value;
    if (path) {
      const buf = Buffer.from(b64, "base64");
      await writeFile(path, buf);
    }
    return b64;
  }

  async waitForElement(
    css: string,
    timeoutMs = 10000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        return await this.findElement(css);
      } catch {
        await sleep(200);
      }
    }
    throw new Error(`waitForElement("${css}") timed out after ${timeoutMs}ms`);
  }

  async waitForText(
    css: string,
    text: string,
    timeoutMs = 10000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const elements = await this.findElements(css);
        for (const elementId of elements) {
          const content = await this.getText(elementId);
          if (content.includes(text)) return elementId;
        }
      } catch {
        // Element might not exist yet
      }
      await sleep(200);
    }
    throw new Error(
      `waitForText("${css}", "${text}") timed out after ${timeoutMs}ms`
    );
  }

  async waitForNoElement(
    css: string,
    timeoutMs = 5000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await this.findElement(css);
        await sleep(200);
      } catch {
        return; // Element not found — success
      }
    }
    throw new Error(
      `waitForNoElement("${css}") — element still exists after ${timeoutMs}ms`
    );
  }

  async waitForAppReady(timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const ready = await this.executeSync<boolean>(`return ${APP_READY_SCRIPT};`);
        if (ready) return;
      } catch {
        // The window may still be booting.
      }
      await sleep(200);
    }
    throw new Error(`waitForAppReady timed out after ${timeoutMs}ms`);
  }

  // ── Internal HTTP helpers ─────────────────────────────────────────

  private get sid(): string {
    if (!this.sessionId) throw new Error("No WebDriver session. Call createSession() first.");
    return this.sessionId;
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`);
    const body = await res.json();
    if (body.value?.error) throw new Error(`WebDriver error: ${body.value.message}`);
    return body;
  }

  private async post(path: string, data: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (body.value?.error) throw new Error(`WebDriver error: ${body.value.message}`);
    return body;
  }

  private async delete(path: string): Promise<void> {
    await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
  }
}
