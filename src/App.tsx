import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { DocumentSummary, Folder, Note, Settings, TagCount } from "./api";
import { Library } from "./library/Library";
import { SettingsPanel } from "./settings/SettingsPanel";
import { Workspace, type WorkspaceHandle } from "./workspace/Workspace";

type View = "library" | "editor";

/** The main window: the library is home; the editor opens over it with its tabs kept. */
function App() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasTabs, setHasTabs] = useState(false);
  const [error, setError] = useState("");
  const workspaceRef = useRef<WorkspaceHandle>(null);

  const refreshDocs = useCallback(async () => {
    setDocs(await invoke<DocumentSummary[]>("list_documents"));
  }, []);

  const refreshAll = useCallback(async () => {
    const [nextDocs, nextFolders, nextTags] = await Promise.all([
      invoke<DocumentSummary[]>("list_documents"),
      invoke<Folder[]>("list_folders"),
      invoke<TagCount[]>("list_tags"),
    ]);
    setDocs(nextDocs);
    setFolders(nextFolders);
    setTags(nextTags);
  }, []);

  const report = useCallback((err: unknown) => setError(String(err)), []);

  useEffect(() => {
    void refreshAll().catch(report);
    void invoke<Settings>("get_settings").then(setSettings).catch(report);
  }, [refreshAll, report]);

  // Memo windows change documents too; catch up when this window comes back.
  useEffect(() => {
    const onFocus = () => void refreshAll().catch(report);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAll, report]);

  const openDocument = useCallback((id: string) => {
    workspaceRef.current?.open(id);
    setHasTabs(true);
    setView("editor");
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("open-document", (event) => {
      void refreshDocs().catch(report);
      openDocument(event.payload);
    });
    // A memo can ask for the editor while this window is closed; it is handed over here.
    void invoke<string | null>("take_pending_document").then((id) => {
      if (id) openDocument(id);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [openDocument, refreshDocs, report]);

  async function createNote(folderId: string | null) {
    setError("");
    try {
      const note = await invoke<Note>("create_document", { folderId });
      await refreshDocs();
      openDocument(note.id);
    } catch (err: unknown) {
      report(err);
    }
  }

  const tagNames = useMemo(() => tags.map((tag) => tag.name), [tags]);
  const onSaved = useCallback(() => void refreshDocs().catch(report), [refreshDocs, report]);
  const onMetaChanged = useCallback(() => void refreshAll().catch(report), [refreshAll, report]);

  return (
    <>
      {error ? (
        <p className="error-banner app-error" role="alert" onClick={() => setError("")}>
          {error}
        </p>
      ) : null}
      <Library
        visible={view === "library"}
        docs={docs}
        folders={folders}
        tags={tags}
        settings={settings}
        hasOpenTabs={hasTabs}
        onOpen={openDocument}
        onOpenEditor={() => setView("editor")}
        onCreateNote={(folderId) => void createNote(folderId)}
        onOpenSettings={() => setSettingsOpen(true)}
        onChanged={onMetaChanged}
      />
      <Workspace
        ref={workspaceRef}
        visible={view === "editor"}
        docs={docs}
        folders={folders}
        tagNames={tagNames}
        settings={settings}
        onHome={() => {
          setHasTabs(workspaceRef.current?.hasTabs() ?? false);
          setView("library");
          void refreshAll().catch(report);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onSaved={onSaved}
        onMetaChanged={onMetaChanged}
      />
      {settingsOpen ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} onSettingsChange={setSettings} />
      ) : null}
    </>
  );
}

export default App;
