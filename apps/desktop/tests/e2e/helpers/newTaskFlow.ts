export interface NewTaskFlowClient {
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
  sendKeys(elementId: string, text: string): Promise<void>;
}

const NEW_TASK_MODAL_SELECTOR = ".modal-overlay";
const NEW_TASK_TEXTAREA_SELECTOR = ".modal-overlay textarea";
const CYCLE_PROVIDER_SCRIPT = `const modal = document.querySelector(".modal");
modal?.dispatchEvent(new KeyboardEvent("keydown", {
  key: "]",
  metaKey: true,
  shiftKey: true,
  bubbles: true,
}));`;

export async function submitTaskFromUi(
  client: NewTaskFlowClient,
  prompt: string,
): Promise<void> {
  await client.executeSync(
    `document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "N",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    }));`,
  );

  await client.waitForElement(NEW_TASK_MODAL_SELECTOR, 2000);
  await client.executeSync(CYCLE_PROVIDER_SCRIPT);
  await client.executeSync(CYCLE_PROVIDER_SCRIPT);
  const textarea = await client.waitForElement(NEW_TASK_TEXTAREA_SELECTOR, 2000);
  await client.sendKeys(textarea, prompt);

  await client.executeSync(
    `const textarea = document.querySelector(${JSON.stringify(NEW_TASK_TEXTAREA_SELECTOR)});
     textarea?.dispatchEvent(new KeyboardEvent("keydown", {
       key: "Enter",
       metaKey: true,
       bubbles: true,
     }));`,
  );

  await client.waitForNoElement(NEW_TASK_MODAL_SELECTOR, 5000);
}
