import {
  buildGlobalKeydownScript,
  buildSelectorKeydownScript,
} from "./keyboard";

export interface NewTaskFlowClient {
  executeSync<T = unknown>(script: string, args?: unknown[]): Promise<T>;
  waitForElement(css: string, timeoutMs?: number): Promise<string>;
  waitForNoElement(css: string, timeoutMs?: number): Promise<void>;
  sendKeys(elementId: string, text: string): Promise<void>;
  click(elementId: string): Promise<void>;
}

export interface SubmitTaskFromUiOptions {
  providerSwitchCount?: number;
}

const NEW_TASK_MODAL_SELECTOR = ".modal-overlay";
const NEW_TASK_TEXTAREA_SELECTOR = ".modal-overlay textarea";
const NEW_TASK_MODAL_INNER_SELECTOR = ".modal";
const NEW_TASK_SUBMIT_BUTTON_SELECTOR = ".modal-overlay .btn-primary";
const CYCLE_PROVIDER_SCRIPT = buildSelectorKeydownScript(NEW_TASK_MODAL_INNER_SELECTOR, {
  key: "]",
  meta: true,
  shift: true,
});

export async function submitTaskFromUi(
  client: NewTaskFlowClient,
  prompt: string,
  options: SubmitTaskFromUiOptions = {},
): Promise<void> {
  await client.executeSync(buildGlobalKeydownScript({
    key: "N",
    meta: true,
    shift: true,
  }));

  await client.waitForElement(NEW_TASK_MODAL_SELECTOR, 2000);
  for (let index = 0; index < (options.providerSwitchCount ?? 0); index += 1) {
    await client.executeSync(CYCLE_PROVIDER_SCRIPT);
  }
  const textarea = await client.waitForElement(NEW_TASK_TEXTAREA_SELECTOR, 2000);
  await client.sendKeys(textarea, prompt);
  const submitButton = await client.waitForElement(NEW_TASK_SUBMIT_BUTTON_SELECTOR, 2000);
  await client.click(submitButton);

  await client.waitForNoElement(NEW_TASK_MODAL_SELECTOR, 5000);
}
