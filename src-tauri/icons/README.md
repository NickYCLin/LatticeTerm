# LatticeTerm 應用程式圖示

`icon-source.png` 是桌面應用程式圖示的 1024 x 1024 RGBA 透明母檔。

## 設計理念

- 左側終端提示符代表 SSH 與命令列工作流程。
- 右側螢幕代表 RDP、VNC 等圖形化遠端桌面。
- 兩個平面在中央交疊成折疊閘道，象徵多種遠端協定在 LatticeTerm 工作區中交織整合。
- 薄荷綠與冷藍延續應用程式的深色介面與品牌色。

## 重新產生平台圖示

在專案根目錄執行：

```powershell
npm run tauri -- icon src-tauri/icons/icon-source.png
```

指令會產生 Windows、macOS 與通用 PNG 圖示。行動平台圖示目前未納入版本控制，因為本專案現階段以桌面平台為目標。
