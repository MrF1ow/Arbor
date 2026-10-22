import { toast } from "sonner";

import { invoke } from "~/lib/ipc";

export async function startDictation(): Promise<void> {
  try {
    await invoke("start_dictation");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
