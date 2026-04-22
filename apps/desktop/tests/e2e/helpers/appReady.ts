export const APP_READY_SCRIPT = `(() => {
  const hook = window.__KANNA_E2E__;
  return Boolean(hook?.ready);
})()`;

export const APP_DB_NAME_SCRIPT = `(() => {
  const hook = window.__KANNA_E2E__;
  return typeof hook?.dbName === "string" && hook.dbName.length > 0
    ? hook.dbName
    : null;
})()`;
