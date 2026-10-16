<div align="center">

# AirBridge

**以 ESP32-S3 為核心，讓 Windows 接入 AirDrop 的實驗性橋接專案。**

[English](README.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE) ![ESP-IDF 6.1](https://img.shields.io/badge/ESP--IDF-6.1-334155?style=flat-square) ![C++17](https://img.shields.io/badge/C%2B%2B-17-334155?style=flat-square)

</div>

AirBridge 由 ESP32-S3 負責 Wi-Fi 與藍牙，透過序列埠連接 Windows。可攜式 C++17 核心實作 AWDL 封包、同步與協定解析，ESP-IDF 6.1 提供無線後端；Tauri 2 桌面應用程式仍在規劃中。

> 本 README 描述此歷史版本當時具備的能力；後續版本的檔案傳輸成果不代表此版本已通過驗收。

## 專案狀態

原生二進位檔接收已通過 SHA256 驗證。Windows 接收端新增分段序列資料保留與常駐執行功能；長時間可發現性與獨立傳送仍待完成。

| 功能 | 狀態 |
| :--- | :--- |
| AWDL 解析、時鐘與拓樸 | 已實作 |
| Apple 鄰居接納 | 已通過實機驗證 |
| AWDL 上的 IPv6 | 已通過實機驗證 |
| 原生裝置名稱 | 已透過 TLS `/Discover` 驗證 |
| Mac → Windows 檔案接收 | 已驗證文字檔與 262,145 位元組二進位檔 |
| Windows → Mac 檔案傳送 | 尚未實作 |
| 桌面應用程式 | Tauri 2 · React · TypeScript · Rust — 規劃中 |

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
  -D "AIRBRIDGE_PROBE_PEER=$peer" build
```

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

## 驗證

**可攜式協定檢查: 277.** **Windows 接收端測試: 12.**

可攜式測試涵蓋畸形封包、邊界、同步與協定線格式；主機測試檢查偏移、雜湊與可靠落盤的失敗情況。實機證據另行記錄。

```powershell
cmd /c scripts\test-native.cmd
```

```powershell
python -m unittest discover -s tests -p test_receiver.py -q
```

## 系統架構

```mermaid
flowchart LR
  Apple["Apple 裝置"] <-->|"AWDL · IPv6 · TLS"| ESP["ESP32-S3 / ESP-IDF 6.1"]
  ESP <-->|"序列埠"| PC["Windows 主機"]
  PC -.-> UI["Tauri 2 桌面 · 規劃中"]
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

- [協定參考](docs/protocol-references.md)
- [AWDL 鄰居接納](docs/awdl-qualification.md)
- [IPv6 資料往返](docs/ipv6-qualification.md)
- [Discover 原生名稱](docs/discover-qualification.md)
- [串流封存核心](docs/transfer-core.md)
- [原生接收與檔案雜湊](docs/native-receiving.md)

## 後續規劃

- [ ] 獨立實作 Windows → Apple 傳送與往返雜湊驗證
- [ ] 穩定發現、重新連線復原與明確的失敗狀態
- [ ] 擴充對端選擇、真實名稱與傳輸進度
- [ ] 以 Tauri 2、React、TypeScript 與 Rust 製作桌面應用程式
- [ ] 擴充裝置、檔案大小與傳輸介面的驗證範圍

## 致謝

主要 Linux 參考為 [t4t5/omdrop-owl](https://github.com/t4t5/omdrop-owl)，其固定信道策略、同步來源選擇與接收填補處理，提供互通需求的重要依據。也感謝 [OWL](https://github.com/seemoo-lab/owl) 與 [OpenDrop](https://github.com/seemoo-lab/opendrop) 對 AWDL 和 AirDrop 的研究。參考用途與固定版本記錄於[協定參考](docs/protocol-references.md)；此原始碼樹未收錄上述專案的協定原始碼。

## 授權

[MIT](LICENSE)。AirDrop 為 Apple 的技術。AirBridge 是獨立的實驗性專案，與 Apple 無隸屬關係，也未獲其背書。
