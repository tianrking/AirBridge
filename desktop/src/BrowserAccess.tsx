import {
  ArrowUpRight,
  Check,
  CircleHelp,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { browserSupport, type SupportCode } from "./web/platform";
import type { Language } from "./types";
import "./browser-access.css";

type AccessCopy = {
  ready: string;
  attention: string;
  compatible: string;
  details: string;
  privacy: string;
  steps: string[];
  denied: string;
  full: string;
  issues: Record<SupportCode, string>;
};
const copy: Record<Language, AccessCopy> = {
  en: {
    ready: "Your browser. Your bridge.",
    attention: "A full browser makes the connection.",
    compatible:
      "Desktop Chrome or Edge · Permissions requested only when you choose to connect.",
    details: "Connection & permissions",
    privacy:
      "File contents travel through your browser and bridge, without an AirBridge upload server.",
    steps: [
      "Choose a receive folder and allow read/write access to that folder.",
      "Click Connect, select the ESP32-S3 bridge and approve serial access. Web Serial does not show Windows COM numbers.",
      "Keep this tab open and your computer awake. Only one application can own the port; disconnect Tauri or other serial tools first.",
    ],
    denied:
      "Dismissed a prompt? Try the button again. If access is blocked, review this site's serial/file permissions in the browser address bar. Safari, Firefox and mobile browsers do not provide the full APIs this app needs.",
    full: "Open in a full browser tab",
    issues: {
      insecure:
        "HTTPS or localhost is required. Reopen this page using its HTTPS address.",
      embedded:
        "Embedded previews cannot provide the complete device and folder permissions. Open this page directly in desktop Chrome or Edge.",
      policy:
        "Serial access is blocked by the page or an administrator policy. Open the full page and review browser policies.",
      serial:
        "Web Serial is unavailable. Open this page in current desktop Chrome or Edge.",
      storage:
        "Folder read/write access is unavailable. Use current desktop Chrome or Edge with file-system access enabled.",
    },
  },
  "zh-Hant": {
    ready: "你的瀏覽器，你的橋接器。",
    attention: "在完整瀏覽器中建立連線。",
    compatible: "電腦版 Chrome 或 Edge · 只有你選擇連線時才會請求授權。",
    details: "連線與權限",
    privacy: "檔案內容經由瀏覽器與橋接器傳輸，不經過 AirBridge 上傳伺服器。",
    steps: [
      "選擇接收資料夾，並允許讀取及寫入該資料夾。",
      "按下「連接」，選取 ESP32-S3 橋接器並允許序列埠存取。Web Serial 不會顯示 Windows COM 編號。",
      "傳輸時保持分頁開啟及電腦喚醒。序列埠只能由一個應用程式使用；請先中斷 Tauri 或其他串列工具。",
    ],
    denied:
      "關閉授權視窗後可再次點選按鈕。若權限遭封鎖，請在網址列的網站設定檢查序列埠與檔案權限。Safari、Firefox 與行動瀏覽器未提供本程式需要的完整 API。",
    full: "在完整瀏覽器分頁開啟",
    issues: {
      insecure: "需要 HTTPS 或 localhost。請使用 HTTPS 網址重新開啟。",
      embedded:
        "內嵌預覽無法提供完整的裝置與資料夾權限，請直接使用電腦版 Chrome 或 Edge 開啟。",
      policy:
        "網頁或管理員政策封鎖了序列埠存取。請開啟完整分頁並檢查瀏覽器政策。",
      serial: "無法使用 Web Serial，請用最新版電腦 Chrome 或 Edge 開啟。",
      storage:
        "無法讀寫接收資料夾，請使用已啟用檔案系統存取的最新版電腦 Chrome 或 Edge。",
    },
  },
  es: {
    ready: "Tu navegador. Tu puente.",
    attention: "Conecta desde un navegador completo.",
    compatible:
      "Chrome o Edge de escritorio · Los permisos se solicitan solo cuando decides conectar.",
    details: "Conexión y permisos",
    privacy:
      "El contenido pasa por tu navegador y el puente, sin un servidor de carga de AirBridge.",
    steps: [
      "Elige una carpeta de recepción y permite su lectura y escritura.",
      "Pulsa Conectar, elige el puente ESP32-S3 y permite el acceso serie. Web Serial no muestra los números COM de Windows.",
      "Mantén la pestaña abierta y el equipo despierto. Solo una aplicación puede usar el puerto; desconecta primero Tauri u otras herramientas serie.",
    ],
    denied:
      "¿Cerraste una solicitud? Vuelve a pulsar el botón. Si el acceso está bloqueado, revisa los permisos del sitio en la barra de direcciones. Safari, Firefox y los navegadores móviles no ofrecen todas las API necesarias.",
    full: "Abrir en una pestaña completa",
    issues: {
      insecure: "Se requiere HTTPS o localhost. Abre la dirección HTTPS.",
      embedded:
        "Las vistas incrustadas no ofrecen todos los permisos de dispositivo y carpeta. Abre la página directamente en Chrome o Edge de escritorio.",
      policy:
        "Una política de la página o del administrador bloquea el puerto serie. Abre la página completa y revisa las políticas.",
      serial:
        "Web Serial no está disponible. Usa Chrome o Edge de escritorio actualizado.",
      storage:
        "No hay acceso de lectura/escritura a carpetas. Usa Chrome o Edge de escritorio con acceso al sistema de archivos.",
    },
  },
};

export function BrowserAccess({ language }: { language: Language }) {
  const text = copy[language];
  const code = browserSupport();
  return (
    <section
      className={`browser-access ${code ? "needs-browser" : ""}`}
      data-support={code ?? "ready"}
      aria-label={text.details}
    >
      <div className="browser-access-heading">
        <span className="access-symbol">
          {code ? <CircleHelp size={19} /> : <ShieldCheck size={19} />}
        </span>
        <div>
          <strong>{code ? text.attention : text.ready}</strong>
          <p>{code ? text.issues[code] : text.compatible}</p>
        </div>
        {!code && (
          <span className="access-available">
            <Check size={13} /> Web Serial
          </span>
        )}
      </div>
      <details open={Boolean(code)}>
        <summary>{text.details}</summary>
        <div className="access-instructions">
          <ol>
            {text.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>{text.denied}</p>
          <p className="access-privacy">
            <LockKeyhole size={13} />
            {text.privacy}
          </p>
          {code === "embedded" && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text.full}
              <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </details>
    </section>
  );
}

export function permissionHelp(
  error: string | null,
  language: Language,
): string | null {
  return error && /(?:NotAllowedError|SecurityError|NotFoundError)/.test(error)
    ? copy[language].denied
    : null;
}
