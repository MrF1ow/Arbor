import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { SHORTCUT_CATALOG, type ShortcutEntry } from "~/lib/shortcuts";

function ShortcutKeys({ keys }: { keys: string }) {
  const parts = keys.split("+").map((part) => part.trim());
  return (
    <KbdGroup>
      {parts.map((part, index) => (
        <Kbd key={`${part}-${index}`}>{part}</Kbd>
      ))}
    </KbdGroup>
  );
}

export function SettingsShortcutsPanel() {
  const groups = SHORTCUT_CATALOG.reduce<Map<string, ShortcutEntry[]>>((acc, entry) => {
    const group = entry.group ?? "Other";
    const list = acc.get(group) ?? [];
    list.push(entry);
    acc.set(group, list);
    return acc;
  }, new Map());

  return (
    <div className="space-y-6" data-testid="settings-shortcuts">
      {[...groups.entries()].map(([group, entries]) => (
        <SettingsSection key={group} title={group}>
          {entries.map((entry) => (
            <SettingRow
              key={`${group}-${entry.description}`}
              label={entry.description}
              control={<ShortcutKeys keys={entry.keys} />}
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}
