# 工程

殼、資料庫、測試。產品行為寫在其他檔，這裡只記怎麼把它跑起來。

相關：[document.md](document.md)、[../../development.md](../development.md)

## 共識

- Tauri 2。
- 領域和存檔在 Rust。前端透過 command 讀寫，不自己開資料庫。
- SQLite，一個檔放在 app data。開啟 WAL。開發版和正式版的資料目錄分開。
- 附件在旁邊的 `assets/`。備份時資料庫檔和這個目錄一起複製。
- 不用 PostgreSQL。多人同步以後再想，本機仍然是這份 SQLite。
- 要有 CI，用來跑測試。

## 先照這個做

前期的 command 圍繞文件，而不是只圍繞「筆記」：

- `list_documents`、`get_document`、`create_document`、`update_document`、`delete_document`
- `search_documents`
- `save_asset`
- `list_versions`、`restore_version`

標籤和連結會再加 command，但不另做一套存取路徑。

CI 先跑 Rust 測試，以及前端能一起建置。不在前期擴成完整的發布流水線。

`.gitignore` 要含前端依賴和建置產物。現在的檔案只有 Rust 的忽略規則。

## 待決定

- [ ] 前端用 React 還是 Svelte？
- [ ] 介面語言：中文、英文，或先不做 i18n？
- [ ] CI 放在 GitHub Actions，還是你之後用的別的地方？

## 完成時

- [ ] Tauri 專案放進這個 repo，視窗打得開
- [ ] 前端能呼叫一個 Rust command
- [ ] SQLite、第一版 schema、migration 能在乾淨目錄建起來
- [ ] CI 會跑測試

## 我的筆記


