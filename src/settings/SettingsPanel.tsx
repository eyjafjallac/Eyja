import { TextSettings } from "../editor/TextSettings";
import { Icon, type IconName, SymButton } from "../memo/Icon";
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

type Tab = "text" | "windows" | "memo";

const TABS: { id: Tab; label: string; title: string; icon: IconName }[] = [
  { id: "text", label: "Text & colors", title: "Text and appearance", icon: "text" },
  { id: "windows", label: "Windows", title: "Window sizes", icon: "window" },
  { id: "memo", label: "Quick memo", title: "Quick memo", icon: "memo" },
];

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
    <div className="seg-control" role="radiogroup" aria-label={label}>
      {SIZES.map((size) => (
        <button
          key={size.id}
          type="button"
          role="radio"
          aria-checked={value === size.id}
          className={value === size.id ? "seg-btn active" : "seg-btn"}
          onClick={() => onChange(size.id)}
        >
          {size.label}
        </button>
      ))}
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
  const [tab, setTab] = useState<Tab>("text");
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
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <nav className="settings-nav" aria-label="Settings categories">
          <div className="settings-nav-title">Settings</div>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? "settings-nav-btn active" : "settings-nav-btn"}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <header className="settings-content-head">
            <strong>{active.title}</strong>
            <SymButton icon="close" label="Close (Esc)" tipAlign="right" onClick={onClose} />
          </header>
          {error ? <p className="error-banner">{error}</p> : null}
          <div className="settings-content-body">
            {tab === "text" ? <TextSettings /> : null}
            {tab === "windows" && settings ? (
              <div className="setting-group">
                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-title">Editor and library window</span>
                    <span className="setting-desc">Size of the main window</span>
                  </div>
                  <SizePicker
                    label="Editor and library window"
                    value={settings.mainSize}
                    onChange={(size) => void saveSize("main", size)}
                  />
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-title">New memo window</span>
                    <span className="setting-desc">
                      For new memo windows. A memo window you resize keeps its own size.
                    </span>
                  </div>
                  <SizePicker
                    label="New memo window"
                    value={settings.memoSize}
                    onChange={(size) => void saveSize("memo", size)}
                  />
                </div>
              </div>
            ) : null}
            {tab === "memo" && settings ? (
              <div className="setting-group">
                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-title">Shortcut</span>
                    {settings.memoShortcutActive ? (
                      <span className="setting-desc">
                        Opens a memo window, even while Eyja is in the background
                      </span>
                    ) : (
                      <span className="setting-desc warn">
                        This shortcut is not active. Another app may be using it; pick a different
                        one.
                      </span>
                    )}
                  </div>
                  <div className="setting-controls">
                    <button
                      type="button"
                      className={recording ? "shortcut-recorder recording" : "shortcut-recorder"}
                      onClick={() => setRecording(true)}
                      onBlur={() => setRecording(false)}
                      onKeyDown={onShortcutKey}
                    >
                      {recording ? "Press keys..." : settings.memoShortcut}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void saveShortcut("Ctrl+Shift+M")}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-title">Delete old memos</span>
                    <span className="setting-desc">
                      Off by default: memos stay until you delete them. Deleting a memo removes its
                      copied files and folders from disk; the text stays in history.
                    </span>
                  </div>
                  <div className="setting-controls">
                    <input
                      type="checkbox"
                      aria-label="Delete memos not edited for a number of days"
                      checked={retentionOn}
                      onChange={(event) =>
                        void saveRetention(event.target.checked ? Number(days) : null)
                      }
                    />
                    <span>After</span>
                    <input
                      className="num-input"
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
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
