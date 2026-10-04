# 文件模型

筆記和 memo 的本體。編輯器、主頁、時間軸、匯出都讀這一份。

相關：[editor.md](editor.md)、[memo.md](memo.md)、[history.md](history.md)、[library.md](library.md)

## 共識

- 內文是 Markdown 字串，存在 SQLite。
- 圖片和 gif 的檔案放在 app data 的 `assets/`。資料庫記 id、所屬文件、mime、相對路徑。
- 內文用 `![說明](asset:...)` 引用，不寫絕對路徑，也不把圖嵌成 base64。
- 方程式是內文裡的 LaTeX（`$...$`、`$$...$$`），不另存一張渲染圖。
- 表格是 Markdown 表格。
- 程式碼區塊是 Markdown 圍欄（三個反引號，後面加語言名稱），存在內文裡，不另存一筆。
- 標籤貼在文件上，筆記和 memo 都能貼。標籤本身的畫面在 [library.md](library.md)。
- 一篇文件放在一個資料夾裡。同一個標籤可以出現在不同資料夾的文件上。資料夾是位置，標籤是跨資料夾的標記。
- 刪除文件時，文件和圖片都留下。文件寫上 `deleted_at`，時間軸還讀得到。這是刪除標記，不是一顆普通標籤，避免和用來分類的 tag 混在一起。
- `links.anchor` 存被指到的那一句的文字，不只存目標文件。
- 列表可以置頂、收藏。置頂用 `pinned_at`，有值的排在前面。收藏是 `favorite`。
- 封面是可選的一張圖，顯示在主頁卡片或文件開頭。不設定就沒有圖，不用另外做一張。要設的話，從這篇裡已有的圖片挑一張，記在 `cover_asset_id`。



## 先照這個做

筆記和 memo 用同一種紀錄，用 `kind` 分成 `note` 和 `memo`。叫出來的方式和暫存附件不同，本體相同。這樣標籤、搜尋、時間軸不用做兩套。

連結除了寫在內文裡，另外存一筆「從哪篇到哪篇」。phase 4 的知識圖譜延伸這些邊，不必以後再從全文裡猜。跳轉的用法在 [editor.md](editor.md)。

從第一天就做 schema migration。資料夾可以再放進資料夾（`parent_id`）。若只要一層，把 `parent_id` 拿掉即可。

`anchor` 存句子原文，不存「第幾個字」。內文一改，字的位置會移動，句子文字還能對得上。

```text
folders
  id, name, parent_id, created_at

documents
  id, kind, title, body, folder_id,
  pinned_at, favorite, cover_asset_id, color,
  created_at, updated_at, deleted_at

tags
  id, name

document_tags
  document_id, tag_id

assets
  id, document_id, mime, relative_path, created_at

links
  id, source_id, target_id, anchor, created_at

document_versions
  id, document_id, parent_id, created_at,
  patch, body

schema_migrations
  version, applied_at
```

`document_versions` 的寫入頻率在 [history.md](history.md)。`body` 只在檢查點有全文，其餘列用 `patch` 存和上一版的差異。`folder_id` 可以是空的，表示還沒放進任何資料夾。`color` 給 memo 小視窗用，見 [memo.md](memo.md)。

## 待決定

目前沒有。下一輪有問題再加，每項下面留 `A:`。

## 我的筆記

