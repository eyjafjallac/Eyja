import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { type KeyboardEvent, useEffect, useState } from "react";

type WindowSize = "small" | "medium" | "large";

type Settings = {
  memoShortcut: string;
  memoShortcutActive: boolean;
  memoRetentionDays: number | null;
  memoSize: WindowSize;
  mainSize: WindowSize;
};

const DEFAULT_RETENTION_DAYS = 30;
const SIZES: { id: WindowSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

function SizePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: WindowSize;
  onChange: (size: WindowSize) => void;
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <div className="settings-segments" role="radiogroup" aria-label={label}>
        {SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            role="radio"
            aria-checked={value === size.id}
            className={value === size.id ? "active" : ""}
            onClick={() => onChange(size.id)}
          >
            {size.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function shortcutKey(code: string) {
  if (/^(Control|Shift|Alt|Meta|OS)/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

function shortcutFromEvent(event: KeyboardEvent) {
  const key = shortcutKey(event.code);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  const hasModifier = event.ctrlKey || event.altKey || event.metaKey;
  // A plain letter would fire while typing anywhere; function keys are fine alone.
  if (!hasModifier && !/^F\d+$/.test(key)) return null;
  return [...parts, key].join("+");
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recording, setRecording] = useState(false);
  const [days, setDays] = useState(String(DEFAULT_RETENTION_DAYS));
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((loaded) => {
        setSettings(loaded);
        if (loaded.memoRetentionDays) setDays(String(loaded.memoRetentionDays));
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !recording) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, recording]);

  async function saveShortcut(shortcut: string) {
    setError("");
    try {
      setSettings(await invoke<Settings>("set_memo_shortcut", { shortcut }));
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function saveRetention(next: number | null) {
    setError("");
    if (next !== null) {
      if (!Number.isInteger(next) || next < 1) {
        setError("Use a whole number of days, 1 or more.");
        return;
      }
      const enabling = settings?.memoRetentionDays !== next;
      if (
        enabling &&
        !(await confirm(
          `Memos not edited in the last ${next} days will be deleted now, along with their copied files. Continue?`,
          { kind: "warning", okLabel: "Delete old memos" },
        ))
      ) {
        return;
      }
    }
    try {
      setSettings(await invoke<Settings>("set_memo_retention", { days: next }));
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function saveSize(target: "memo" | "main", size: WindowSize) {
    setError("");
    try {
      setSettings(await invoke<Settings>("set_window_size", { target, size }));
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  function onShortcutKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) return;
    setRecording(false);
    void saveShortcut(shortcut);
  }

  const retentionOn = settings?.memoRetentionDays != null;

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <section
        className="settings-panel"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <p className="error settings-error">{error}</p> : null}
        {settings ? (
          <>
            <h3>Window size</h3>
            <SizePicker
              label="Memo"
              value={settings.memoSize}
              onChange={(size) => void saveSize("memo", size)}
            />
            <p className="settings-hint">
              For new memo windows. A memo window you resize keeps its own size.
            </p>
            <SizePicker
              label="Editor and library"
              value={settings.mainSize}
              onChange={(size) => void saveSize("main", size)}
            />
            <h3>Memo</h3>
            <div className="settings-row">
              <span>Shortcut</span>
              <button
                type="button"
                className={recording ? "settings-shortcut recording" : "settings-shortcut"}
                onClick={() => setRecording(true)}
                onBlur={() => setRecording(false)}
                onKeyDown={onShortcutKey}
              >
                {recording ? "Press keys..." : settings.memoShortcut}
              </button>
              <button type="button" onClick={() => void saveShortcut("Ctrl+Shift+M")}>
                Reset
              </button>
            </div>
            {settings.memoShortcutActive ? null : (
              <p className="settings-hint warn">
                This shortcut is not active. Another app may be using it; pick a different one.
              </p>
            )}
            <div className="settings-row">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={retentionOn}
                  onChange={(event) =>
                    void saveRetention(event.target.checked ? Number(days) : null)
                  }
                />
                Delete memos not edited for
              </label>
              <input
                className="settings-days"
                type="number"
                min={1}
                value={days}
                aria-label="Days"
                onChange={(event) => setDays(event.target.value)}
                onBlur={() => {
                  if (retentionOn && Number(days) !== settings.memoRetentionDays) {
                    void saveRetention(Number(days));
                  }
                }}
              />
              <span>days</span>
            </div>
            <p className="settings-hint">
              Off by default: memos stay until you delete them. Deleting a memo removes its copied
              files and folders from disk; the text stays in history.
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}
