export const APP_READY_SCRIPT = `(() => {
  const hook = window.__KANNA_E2E__;
  const setupState = hook?.setupState;
  if (!setupState) return false;
  const ready = setupState.e2eAppReady;
  if (ready && typeof ready === "object" && "__v_isRef" in ready) {
    return Boolean(ready.value);
  }
  return Boolean(ready);
})()`;
