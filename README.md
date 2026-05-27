# 愛海小旅行｜海洋廢棄物平台

這是一個可操作的本機/雲端 Node.js 網站雛形，提供：

- 首頁與即時累計資料
- ICC 19 項淨灘成果登記
- 安全沙灘評估：魚鉤、金屬製品
- 其他廢棄物 3 組
- 統計分析與 TOP10 圖表
- 淨灘地圖
- CSV 數據下載
- 後台審核、下架、刪除與含 Email CSV 下載

## 本機啟動

```bash
npm start
```

預設網址：

```text
http://127.0.0.1:8790
```

後台：

```text
http://127.0.0.1:8790/#admin
```

預設後台密碼：

```text
cleanocean-admin
```

可用環境變數覆蓋：

```bash
PORT=8790
HOST=0.0.0.0
ADMIN_TOKEN=your-password
```

## 部署建議

GitHub 只負責保存原始碼。因為這個網站有 API 與 JSON 資料寫入功能，不能直接用 GitHub Pages 完整運作。

建議部署到可執行 Node.js 的平台：

- Render
- Railway
- Zeabur
- Fly.io

部署設定：

- Build Command：留空或 `npm install`
- Start Command：`npm start`
- Environment Variables：
  - `ADMIN_TOKEN`：請改成正式後台密碼
  - `HOST=0.0.0.0`

## 注意

目前資料存在 `data/records.json`。這適合展示與早期測試；正式多人使用時，建議改為 PostgreSQL、Supabase、Firebase 或其他資料庫。
