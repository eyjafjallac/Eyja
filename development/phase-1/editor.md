# 編輯器

通過主頁進入的寫作畫面。目標是用這個 app 把文章寫出來。

相關：[document.md](document.md)、[history.md](history.md)、[export.md](export.md)、[library.md](library.md)

## 共識

- 寫法像 Obsidian。打方程式就寫方程式的語法，放圖片就放圖片，不另按一個「渲染」鍵，當場畫出來。
- 前期要容納圖片、gif、方程式、表格、程式碼區塊。
- 程式碼區塊用 Markdown 圍欄（三個反引號，後面加語言名稱）寫，當場渲染，並做語法高亮。
- gif 當圖片附件處理，mime 不同而已。
- 方程式用 KaTeX 畫。真正編譯 LaTeX 檔在 [phase 2](../phase-2/latex.md)，不裝進前期。
- 進入編輯器後，左邊有入口打開最近的檔案。這個列表用來切換文件，或變成 split editor。
- 在編輯器裡也可以新增文件。主頁同樣可以，規則見 [library.md](library.md)。
- 有一份片段字典，用來插入不好記的結構，例如 matrix、table。選了就插入對應的 Markdown。
- 可以引用另一篇文章，按一下跳過去。學術參考文獻（`\cite` 那種）跟著 phase 2 的 LaTeX，不和這種跳轉混成一件事。

## 先照這個做

儲存格式維持 Markdown，所以元件要能來回存成同一段字串。

兩條都做得到 Obsidian 那種當場渲染：

- CodeMirror 6 的即時預覽：打字時看得到語法，游標離開後收成渲染結果。和「寫什麼就存什麼」最接近。
- Milkdown Crepe：打開就是排好的版，底層仍是 Markdown。Crepe 會帶進 Vue。

跳轉語法先用 `[[文件]]`。資料庫裡的邊怎麼存，見 [document.md](document.md)。

## 待決定

確定的勾起來，並在 `A:` 寫結論。不確定的不要勾，把想法留在 `A:`。

- [ ] 用 CodeMirror 6，還是 Milkdown？

  A:

- [ ] 最近列表顯示幾筆？

  A:

- [ ] split 是左右各一篇，還是先只做切換、split 晚一點？

  A:

- [ ] 片段字典前期要內建哪些範本？

  A:

- [ ] 引用是打 `[[` 就跳出候選，還是另有一個挑選視窗？

  A:

## 我的筆記


