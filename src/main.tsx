import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MEMO_LABEL_PREFIX, MemoApp } from "./memo/MemoApp";

const Root = getCurrentWindow().label.startsWith(MEMO_LABEL_PREFIX) ? MemoApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
