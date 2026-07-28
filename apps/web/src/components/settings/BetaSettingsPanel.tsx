import { useEffect, useState } from "react";

import { MAX_MAX_TABS_PER_THREAD, MIN_MAX_TABS_PER_THREAD } from "@eflob/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const AUTO_SETTLE_MIN_DAYS = 1;
const AUTO_SETTLE_MAX_DAYS = 90;
const AUTO_SETTLE_DEFAULT_DAYS = 3;

function MaxTabsPerThreadSlider({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (count: number) => void;
}) {
  // Local draft so the thumb tracks the drag smoothly; the setting only
  // commits once per drag (on release), not on every intermediate value.
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex w-full items-center gap-3 sm:w-56">
      <Slider
        min={MIN_MAX_TABS_PER_THREAD}
        max={MAX_MAX_TABS_PER_THREAD}
        step={1}
        value={draft}
        onValueChange={(next) => setDraft(Array.isArray(next) ? (next[0] ?? value) : next)}
        onValueCommitted={(next) => onCommit(Array.isArray(next) ? (next[0] ?? value) : next)}
        aria-label="Maximum tabs per thread"
      />
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {draft}
      </span>
    </div>
  );
}

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number) => void;
}) {
  // Local draft so the field can be emptied mid-edit; the setting only moves
  // on valid input and snaps back to the persisted value on blur.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      type="number"
      min={AUTO_SETTLE_MIN_DAYS}
      max={AUTO_SETTLE_MAX_DAYS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        // Number(), not parseInt: "3.5" must be rejected (not truncated to a
        // committed 3 while the field shows 3.5) — commit only when the
        // persisted value matches the displayed one.
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= AUTO_SETTLE_MIN_DAYS &&
          parsed <= AUTO_SETTLE_MAX_DAYS
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Days of inactivity before auto-settle"
    />
  );
}

export function BetaSettingsPanel() {
  const sidebarV2Enabled = useClientSettings((settings) => settings.sidebarV2Enabled);
  const sidebarAutoSettleAfterDays = useClientSettings(
    (settings) => settings.sidebarAutoSettleAfterDays,
  );
  const maxTabsPerThread = useClientSettings((settings) => settings.maxTabsPerThread);
  const updateSettings = useUpdateClientSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Beta features">
        <SettingsRow
          title="Max tabs per thread"
          description="How many file/diff/plan/preview tabs can stay open for a single thread at once. Opening past the limit closes the least-recently-used one."
          control={
            <MaxTabsPerThreadSlider
              value={maxTabsPerThread}
              onCommit={(count) => updateSettings({ maxTabsPerThread: count })}
            />
          }
        />
        <SettingsRow
          title="Sidebar v2"
          description="One flat thread list in creation order. Active work renders as rich cards; settled threads collapse to compact rows. Settling requires an up-to-date server — on older servers threads simply stay active. Switch back any time."
          control={
            <Switch
              checked={sidebarV2Enabled}
              onCheckedChange={(checked) => updateSettings({ sidebarV2Enabled: Boolean(checked) })}
              aria-label="Enable the sidebar v2 beta"
            />
          }
        />
        {sidebarV2Enabled ? (
          <>
            <SettingsRow
              title="Auto-settle inactive threads"
              description="Threads with no activity for this long settle automatically. Threads on merged or closed PRs always settle."
              control={
                <Switch
                  checked={sidebarAutoSettleAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label="Auto-settle inactive threads"
                />
              }
            />
            {sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                title="Days of inactivity before auto-settle"
                description="Any new activity un-settles a thread automatically."
                control={
                  <AutoSettleDaysInput
                    value={sidebarAutoSettleAfterDays}
                    onCommit={(days) => updateSettings({ sidebarAutoSettleAfterDays: days })}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
