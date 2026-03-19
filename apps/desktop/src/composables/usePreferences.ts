import { ref, type Ref } from "vue";
import type { DbHandle } from "@kanna/db";
import { getSetting, setSetting } from "@kanna/db";

export function usePreferences(db: Ref<DbHandle | null>) {
  const suspendAfterMinutes = ref(30);
  const killAfterMinutes = ref(60);

  const ideCommand = ref("code");
  const gcAfterDays = ref(3);

  async function load() {
    if (!db.value) return;
    const sa = await getSetting(db.value, "suspendAfterMinutes");
    if (sa) suspendAfterMinutes.value = parseInt(sa, 10) || 30;
    const ka = await getSetting(db.value, "killAfterMinutes");
    if (ka) killAfterMinutes.value = parseInt(ka, 10) || 60;
    const ide = await getSetting(db.value, "ideCommand");
    if (ide) ideCommand.value = ide;
    const gc = await getSetting(db.value, "gcAfterDays");
    if (gc) gcAfterDays.value = parseInt(gc, 10) || 3;
  }

  async function save(key: string, value: string) {
    if (!db.value) return;
    await setSetting(db.value, key, value);
    await load();
  }

  return {
    suspendAfterMinutes,
    killAfterMinutes,

    ideCommand,
    gcAfterDays,
    load,
    save,
  };
}
