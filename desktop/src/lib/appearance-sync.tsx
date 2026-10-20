import { useEffect, useRef } from "react";

import { parseAppearance } from "~/domain/theme";
import { useSaveSettingsMutation, useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";

export function useAppearanceSync() {
  const settings = useSettings();
  const saveSettings = useSaveSettingsMutation();
  const saveRef = useRef(saveSettings.mutate);
  useEffect(() => {
    saveRef.current = saveSettings.mutate;
  }, [saveSettings.mutate]);
  const appearance = useUiStore((s) => s.appearance);
  const setAppearance = useUiStore((s) => s.setAppearance);
  const loadedFromSettings = useRef(false);
  const skipSaveAfterHydrate = useRef(false);

  useEffect(() => {
    const fromSettings = settings.data?.appearance;
    if (!fromSettings || loadedFromSettings.current) {
      return;
    }
    const parsed = parseAppearance(fromSettings);
    if (parsed) {
      skipSaveAfterHydrate.current = true;
      setAppearance(parsed);
    }
    loadedFromSettings.current = true;
  }, [setAppearance, settings.data?.appearance]);

  useEffect(() => {
    if (!settings.data || !loadedFromSettings.current) {
      return;
    }
    if (skipSaveAfterHydrate.current) {
      skipSaveAfterHydrate.current = false;
      return;
    }
    if (settings.data.appearance === appearance) {
      return;
    }
    saveRef.current({
      ...settings.data,
      appearance,
    });
  }, [appearance, settings.data]);
}

export function AppearanceSync() {
  useAppearanceSync();
  return null;
}
