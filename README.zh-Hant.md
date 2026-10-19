<div align="center">

# AirBridge

**以 ESP32-S3 為核心，讓 Windows 接入 AirDrop 的實驗性橋接專案。**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge 由 ESP32-S3 負責 Wi-Fi 與藍牙，透過序列埠連接 Windows。可攜式 C++17 核心實作 AWDL 封包、同步與協定解析，ESP-IDF 6.1 提供無線後端；Tauri 2 桌面應用程式採用 React、TypeScript 與單一 Rust 序列埠處理器。

## 網頁應用程式

同一套 React／TypeScript 介面現在支援直接 Web Serial 後端，原有 Tauri／Rust
桌面版仍保留。使用桌面 Chrome／Edge，在 `desktop` 執行 `npm ci`、
`npm run dev`，開啟 **http://127.0.0.1:1420/**。先選擇接收資料夾，再連接
已核對的 COM4。需要支援 `hardware_id` 的新韌體。

已實作原生名稱查詢、裝置選擇、雙向檔案與進度，以及檔案關閉後重新讀取的
SHA256 校驗。瀏覽器介面、真實瀏覽器儲存與虛擬串口測試已通過；真實串口、
使用者選擇的資料夾與原生 AirDrop 往返仍待驗收，不能沿用 CLI 的成功紀錄。

[網頁操作與儲存設計](desktop/README.web.md) · [網頁驗收狀態](docs/web-qualification.md)

## 桌面應用程式

包含裝置選擇、原生檔案與資料夾選擇器、雙向進度、取消、接收位置與傳輸詳情。預設英文，設定中可選繁體中文與西班牙文。名稱取自原生 `/Discover`；尚未解析時會明確標示。

[桌面建置與操作](desktop/README.md) · [桌面實測狀態](docs/desktop-qualification.md)

## 專案狀態

macOS Finder 已找到 **AirBridge PC**，並成功傳送 262,145 位元組二進位檔，來源與接收端 SHA256 一致。6 Mbps 與定向公告／1 Mbps 對照設定均通過限定範圍的原生接收驗證。獨立實作的傳送端也已將 65,537 位元組二進位檔原生傳至 Mac，再以同一韌體接收回傳；三份實際檔案的 SHA256 完全一致。

| 功能 | 狀態 |
| :--- | :--- |
| AWDL 解析、時鐘與拓樸 | 已實作 |
| Apple 鄰居接納 | 已通過實機驗證 |
| AWDL 上的 IPv6 | 已通過實機驗證 |
| 原生裝置名稱 | 已透過 TLS `/Discover` 驗證 |
| Mac → Windows 檔案接收 | 已驗證文字檔與 262,145 位元組二進位檔 |
| Windows → Mac 檔案傳送 | 已驗證 65,537 位元組二進位檔與同韌體往返 |
| Rust 傳輸後端 | 已獨立驗證 4,097 位元組原生二進位檔往返，傳輸未使用 Python |
| 桌面應用程式 | 開發版本已可連接硬體並顯示原生名稱；桌面檔案互通仍在驗收 |

<details>
<summary>已驗證的二進位檔指紋</summary>

`AirBridge-native-receive-262145.bin` · 262,145 位元組

```text
eb3ddcc7caeb6bef3d10eacdfc07ce0a89997ae4741711c528cce1402d65596c
```

</details>

> 目前仍屬開發階段：長時間可發現性、反覆重新連線、更大檔案、iPhone 互通、僅限聯絡人身分驗證與資料夾傳輸尚未通過驗收。掃描到 MAC 或收到發送完成回呼，都不足以證明檔案已送達。

## 硬體與環境需求

| 項目 | 說明 |
| :--- | :--- |
| 開發目標 | ESP32-S3 · 16 MiB Flash · 8 MiB 八線 PSRAM |
| 韌體 SDK | ESP-IDF 6.1 |
| Windows 連線方式 | 原生 USB Serial/JTAG；外接 USB–UART 是另一條尚未驗證的傳輸路徑 |
| Apple 驗收目標 | 啟用 Wi-Fi 與藍牙，並將 AirDrop 設為所有人的 Mac |
| 主機工具 | Python 與 pyserial；協定檢查使用 Visual Studio C++ 工具或 CMake |

接收服務使用 PSRAM 配置有界封存資料緩衝區；較早的純掃描版本不需要這些接收緩衝區。

## 快速開始

### 1. 準備開發板與 SDK

啟用 ESP-IDF 6.1 環境，連接指定開發板並核對序列埠身分；同一時間僅讓一個程序使用該連接埠。

```powershell
python -m pip install -r scripts/requirements.txt
python -m serial.tools.list_ports -v
```

目前主機 CLI 會核對 **COM4** 上指定開發板的 USB 序號。移植到其他開發板前，請檢閱 `scripts/receive-native.py` 的裝置綁定設定。

### 2. 建置韌體

請將範例 MAC 換成掃描器剛取得、正在公告 AirDrop 的 Apple AWDL 裝置位址。目前原生接收服務僅允許此明確指定的對端。

```powershell
$peer = 'aa:bb:cc:dd:ee:ff'
idf.py -C firmware -B work/native `
  -D AIRBRIDGE_PRESENCE_TX=ON `
  -D AIRBRIDGE_IPV6_LINK=ON `
  -D AIRBRIDGE_NATIVE_SERVICE=ON `
  -D AIRBRIDGE_RAW_RATE_1M=ON `
  -D "AIRBRIDGE_PROBE_PEER=$peer" build
```

此命令選用 1 Mbps 對照速率。已記錄的驗收也使用完整 RF 校準，但單獨校準尚未證實可修復發現問題。本機 `scripts/build-firmware.ps1` 支援 `-FullCalibration -LegacyRate1M`，其 SDK 路徑假設請參閱腳本。

### 3. 燒錄已核對的開發板

燒錄會取代目前應用程式，請先保留可用映像並核對開發板身分。專案在 `0x10000` 配置 2 MiB 應用程式分割區，NVS 位於 `0x9000`，PHY 資料位於 `0xf000`；韌體對照時請維持此配置。

```powershell
idf.py -C firmware -B work/native -p COM4 flash
```

### 4. 啟動 Windows 接收端

```powershell
python scripts/receive-native.py --directory received/inbox --log work/receive.jsonl --seconds 0
```

保持 CLI 執行。將 Mac 解鎖並把 AirDrop 設為所有人，從 Finder 分享檔案至 **AirBridge PC**，再比對來源 SHA256、接收紀錄與 Windows 實際檔案。重試前請關閉舊的 Waiting 分享視窗。

每個序列資料區塊都必須獲得確認。Windows 會檢查大小與 SHA256、寫入磁碟並發佈暫存目錄後，才確認傳輸。接收紀錄存於完成目錄旁；失敗的 `.partial` 資料保留供診斷。

### 5. 從 Windows 傳送

請先停止獨立接收程序。傳送 CLI 使用同一條序列埠連線，等待 Apple 原生同意時也能處理接收記錄。

```powershell
python scripts/send-native.py C:\path\to\file.bin --peer $peer `
  --directory received/inbox --log work/duplex.jsonl --listen-after
```

在 Mac 接受原生 AirDrop 提示。CLI 分別顯示來源暫存、等待同意、封存傳輸與原生 HTTP 完成，並透過 `/Discover` 取得裝置名稱。目前限單一檔案、最大 1 MiB；目的端實際檔案 SHA256 仍需獨立驗收。失敗或結果不確定的操作不會自動重送。

## 驗證

**可攜式協定檢查: 346.** **Windows 主機測試: 20.**

可攜式測試涵蓋畸形封包、邊界、同步與協定線格式；主機測試檢查偏移、雜湊與可靠落盤的失敗情況。實機證據另行記錄。

```powershell
cmd /c scripts\test-native.cmd
```

```powershell
cmake -S . -B build
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

```powershell
python -m unittest discover -s tests -p "test_*.py" -q
```

## 系統架構

```mermaid
flowchart LR
  Apple["Apple 裝置"] <-->|"AWDL · IPv6 · TLS"| ESP["ESP32-S3 / ESP-IDF 6.1"]
  ESP <-->|"序列埠"| PC["Windows 主機"]
  PC <--> UI["Tauri 2 · React · TypeScript · Rust"]
```

AWDL 承載 IPv6，mDNS 尋找 AirDrop 服務，TLS 承載發現與傳輸請求。藍牙提供不可連線的喚醒公告；Windows 無線網卡不需要具備 AWDL 注入能力。

AWDL MAC、DNS 服務實例、主機標籤與 AirDrop 顯示名稱各不相同。友善名稱來自對端實際提供的原生 `/Discover` 回應。

## 目錄結構

| 項目 | 說明 |
| :--- | :--- |
| `core/` | 可攜式 C++17 協定核心 |
| `firmware/` | ESP-IDF 無線後端 |
| `scripts/` | 主機與開發工具 |
| `tests/` | 協定與主機驗證 |
| `docs/` | 實測驗收與參考說明 |

## 文件與實測證據

- [原生雙向驗收](docs/native-duplex.md)
- [序列埠控制協定](docs/serial-protocol.md)
- [產品驗收標準](docs/product-acceptance.md)
- [協定參考](docs/protocol-references.md)
- [AWDL 鄰居接納](docs/awdl-qualification.md)
- [IPv6 資料往返](docs/ipv6-qualification.md)
- [Discover 原生名稱](docs/discover-qualification.md)
- [串流封存核心](docs/transfer-core.md)
- [原生接收與檔案雜湊](docs/native-receiving.md)
- [發現穩定性對照](docs/discovery-stability.md)
- [機器可讀的接收紀錄](docs/native-receive-2026-10-16.json)

## 後續規劃

- [x] 獨立實作 Windows → Apple 傳送與同韌體二進位檔往返驗證
- [ ] 穩定發現、重新連線復原與明確的失敗狀態
- [ ] 擴充對端選擇、真實名稱與傳輸進度
- [x] 以 Tauri 2、React、TypeScript 與 Rust 製作桌面開發版本
- [ ] 桌面封裝版本的原生雙向與持續發現驗收
- [ ] 擴充裝置、檔案大小與傳輸介面的驗證範圍

## 致謝

主要 Linux 參考為 [t4t5/omdrop-owl](https://github.com/t4t5/omdrop-owl)，其固定信道策略、同步來源選擇與接收填補處理，提供互通需求的重要依據。也感謝 [OWL](https://github.com/seemoo-lab/owl) 與 [OpenDrop](https://github.com/seemoo-lab/opendrop) 對 AWDL 和 AirDrop 的研究。參考用途與固定版本記錄於[協定參考](docs/protocol-references.md)；此原始碼樹未收錄上述專案的協定原始碼。

## 授權

[MIT](LICENSE)。AirDrop 為 Apple 的技術。AirBridge 是獨立的實驗性專案，與 Apple 無隸屬關係，也未獲其背書。
