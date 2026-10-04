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

## 先照這個做

筆記和 memo 用同一種紀錄，用 `kind` 分成 `note` 和 `memo`。叫出來的方式和暫存附件不同，本體相同。這樣標籤、搜尋、時間軸不用做兩套。

連結除了寫在內文裡，另外存一筆「從哪篇到哪篇」。phase 4 的知識圖譜延伸這些邊，不必以後再從全文裡猜。跳轉的用法在 [editor.md](editor.md)。

從第一天就做 schema migration。

```text
documents
  id, kind, title, body,
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
  id, document_id, title, body, created_at

schema_migrations
  version, applied_at
```

`document_versions` 的寫入頻率在 [history.md](history.md)。`deleted_at` 是軟刪除，還沒定要不要在前期做垃圾桶。

## 待決定

確定的勾起來，並在 `A:` 寫結論。不確定的不要勾，把想法留在 `A:`。

- [ ] 刪除文件時，圖片跟著刪，還是先留著再清掃？

  A:

- [ ] 要不要置頂、收藏、封面這類欄位？

  A:

- [ ] 筆記要不要資料夾？前期的整理方式目前是標籤。

  A:

- [ ] `links.anchor` 前期只記目標文件，還是一併記下句子位置，方便以後連到某個句子？

  A:



## 我的筆記

