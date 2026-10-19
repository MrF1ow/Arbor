import { useEffect, useRef } from "react";

import { parseAppearance } from "~/domain/theme";
import { useSaveSettingsMutation, useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";

export function useAppearanceSync() {
  const settings = useSettings();
  const saveSettings = useSaveSettingsMutation();
  const appearance = useUiStore((s) => s.appearance);
  const setAppearance = useUiStore((s) => s.setAppearance);
  const hydrated = useRef(false);

  useEffect(() => {
    const fromSettings = settings.data?.appearance;
    if (!fromSettings || hydrated.current) {
      return;
    }
    const parsed = parseAppearance(fromSettings);
    if (parsed) {
      setAppearance(parsed);
    }
    hydrated.current = true;
  }, [setAppearance, settings.data?.appearance]);

  useEffect(() => {
    if (!settings.data || !hydrated.current) {
      return;
    }
    if (settings.data.appearance === appearance) {
      return;
    }
    void saveSettings.mutateAsync({
      ...settings.data,
      appearance,
    });
  }, [appearance, saveSettings, settings.data]);
}

export function AppearanceSync() {
  useAppearanceSync();
  return null;
}
