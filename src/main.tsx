// The theme goes first so the screen styles that follow can build on it.
import { followSystemTheme } from "./theme";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyEditorType, readEditorType, watchEditorType } from "./editor/fontSize";
import { MEMO_LABEL_PREFIX, MemoApp } from "./memo/MemoApp";

followSystemTheme();
applyEditorType(readEditorType());
watchEditorType(() => {});

const Root = getCurrentWindow().label.startsWith(MEMO_LABEL_PREFIX) ? MemoApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
