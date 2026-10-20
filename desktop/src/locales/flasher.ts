import type { Language } from "../types";
import type { Phase, Failure } from "../web/flasher";
type FlashCopy = Record<
  | "title"
  | "intro"
  | "requirements"
  | "prepare"
  | "choose"
  | "confirm"
  | "install"
  | "cancel"
  | "retry"
  | "connect"
  | "done"
  | "recovery"
  | "releaseHelp"
  | "busy"
  | "warning"
  | "provenance"
  | "memory"
  | "usb"
  | "download"
  | "integrity"
  | "chip"
  | "flash"
  | "psram"
  | "security"
  | "serial"
  | "verify"
  | "reset"
  | "release"
  | "loading"
  | "ready"
  | "choosing"
  | "inspecting"
  | "writing"
  | "verifying"
  | "resetting"
  | "releasing"
  | "complete"
  | "error"
  | "cancelled"
  | "cleanup_failed"
  | "idle"
  | "cancelling",
  string
>;
export const firmwareMessages: Record<Language, FlashCopy> = {
  en: {
    title: "Install bridge firmware",
    intro: "From a blank board to AirBridge. No Python or desktop installer.",
    requirements:
      "Full AirBridge v0.0.1 · ESP32-S3 · 16 MB Flash · 8 MB octal PSRAM (N16R8). Board shape does not matter; memory and wiring do.",
    prepare: "Check firmware",
    choose: "Choose serial port",
    confirm: "Review your board",
    install: "Install & verify",
    cancel: "Cancel safely",
    retry: "Try again",
    connect: "Connect to AirBridge",
    done: "Firmware verified. Ready to connect.",
    recovery:
      "If interrupted: close other serial apps. Hold BOOT, tap RESET, release BOOT, then choose the download-mode port and install again. Do not unplug while writing. A partial installation will not boot.",
    releaseHelp:
      "Port release is not confirmed. Wait, then retry release. If it stays blocked, close this tab, unplug/replug the board and reopen AirBridge.",
    busy: "Disconnect the bridge and finish serial cleanup before installing.",
    warning:
      "This replaces the existing application and partition table. Use a spare compatible board. The NVS sectors are not erased; unrelated application data is not guaranteed compatible.",
    provenance:
      "Pinned GitHub release · SHA-256 checked before opening a port · chip flash MD5 checked after writing.",
    memory:
      "I confirm this board has 8 MB octal PSRAM, 16 MB or more Flash, and an accessible native USB port. External PSRAM wiring cannot be proven by the ROM.",
    usb: "Flashing can use native USB or a USB–UART bridge. AirBridge v0.0.1 runs on native USB Serial/JTAG: after flashing, use the USB port wired to GPIO19/20 (303A:1001). No automatic port selection.",
    download: "Firmware download failed. Check the connection and try again.",
    integrity:
      "Firmware integrity check failed. No port was opened. Reload the official site.",
    chip: "This image is only for ESP32-S3. No flash was written.",
    flash: "At least 16 MB of Flash is required. No flash was written.",
    psram:
      "Detected PSRAM is incompatible with this image. No flash was written.",
    security:
      "Secure Boot, flash encryption or secure download is configured. This installer will not modify protected devices.",
    serial:
      "Serial communication failed. Close other serial tools and follow the recovery steps.",
    verify:
      "Flash read-back did not match. The installation is incomplete; reinstall before connecting.",
    reset:
      "Flash verified, but reboot was not confirmed. Press RESET manually, then try again.",
    release: "Could not confirm port release. Reconnection is blocked.",
    loading: "Checking release bytes",
    ready: "Firmware ready",
    choosing: "Choose a port in the browser",
    inspecting: "Identifying chip and memory",
    writing: "Writing firmware",
    verifying: "Reading flash digests",
    resetting: "Restarting board",
    releasing: "Releasing serial port",
    complete: "Verified & released",
    error: "Installation failed",
    cancelled: "Cancelled · no success claimed",
    cleanup_failed: "Port cleanup needed",
    idle: "Ready when you are",
    cancelling: "Cancelling · waiting for the current command",
  },
  es: {
    title: "Instalar firmware del puente",
    intro:
      "De una placa vacía a AirBridge. Sin Python ni instalador de escritorio.",
    requirements:
      "AirBridge completo v0.0.1 · ESP32-S3 · Flash de 16 MB · PSRAM octal de 8 MB (N16R8). Importan la memoria y el cableado, no la forma de la placa.",
    prepare: "Comprobar firmware",
    choose: "Elegir puerto serie",
    confirm: "Revisar la placa",
    install: "Instalar y verificar",
    cancel: "Cancelar de forma segura",
    retry: "Reintentar",
    connect: "Conectar a AirBridge",
    done: "Firmware verificado. Listo para conectar.",
    recovery:
      "Si se interrumpe: cierra otras aplicaciones serie. Mantén BOOT, pulsa RESET, suelta BOOT y elige el puerto de descarga para reinstalar. No desconectes durante la escritura. Una instalación parcial no arrancará.",
    releaseHelp:
      "No se ha confirmado la liberación del puerto. Espera y reintenta. Si sigue bloqueado, cierra esta pestaña, desconecta y reconecta la placa y abre AirBridge.",
    busy: "Desconecta el puente y termina la limpieza del puerto antes de instalar.",
    warning:
      "Sustituye la aplicación y la tabla de particiones. Usa una placa compatible de repuesto. No se borran los sectores NVS; no se garantiza la compatibilidad con datos de otra aplicación.",
    provenance:
      "Versión de GitHub fijada · SHA-256 antes de abrir el puerto · MD5 de la memoria tras escribir.",
    memory:
      "Confirmo que la placa tiene PSRAM octal de 8 MB, Flash de al menos 16 MB y USB nativo accesible. La ROM no puede comprobar el cableado de PSRAM externa.",
    usb: "Puedes grabar mediante USB nativo o USB–UART. AirBridge v0.0.1 funciona por USB Serial/JTAG nativo: usa el puerto conectado a GPIO19/20 (303A:1001) después de grabar. El puerto nunca se elige automáticamente.",
    download:
      "No se pudo descargar el firmware. Comprueba la conexión y reintenta.",
    integrity:
      "Falló la integridad del firmware. No se abrió ningún puerto. Recarga el sitio oficial.",
    chip: "Esta imagen es solo para ESP32-S3. No se escribió la memoria.",
    flash: "Se necesitan al menos 16 MB de Flash. No se escribió la memoria.",
    psram: "La PSRAM detectada no es compatible. No se escribió la memoria.",
    security:
      "El dispositivo tiene arranque seguro, cifrado o descarga segura configurados. No se modifican dispositivos protegidos.",
    serial:
      "Falló la comunicación serie. Cierra otras herramientas y sigue los pasos de recuperación.",
    verify: "La lectura de Flash no coincide. Reinstala antes de conectar.",
    reset:
      "Flash verificada, pero reinicio sin confirmar. Pulsa RESET y reintenta.",
    release: "No se confirmó la liberación del puerto. Reconexión bloqueada.",
    loading: "Comprobando la versión",
    ready: "Firmware listo",
    choosing: "Elige un puerto en el navegador",
    inspecting: "Identificando chip y memoria",
    writing: "Escribiendo firmware",
    verifying: "Leyendo resúmenes de Flash",
    resetting: "Reiniciando la placa",
    releasing: "Liberando el puerto",
    complete: "Verificado y liberado",
    error: "Instalación fallida",
    cancelled: "Cancelado · sin confirmar éxito",
    cleanup_failed: "Liberación pendiente",
    idle: "Listo para empezar",
    cancelling: "Cancelando · esperando el comando actual",
  },
  fr: {
    title: "Installer le firmware du pont",
    intro:
      "D’une carte vierge à AirBridge. Sans Python ni installation sur ordinateur.",
    requirements:
      "AirBridge complet v0.0.1 · ESP32-S3 · Flash 16 Mo · PSRAM octale 8 Mo (N16R8). La mémoire et le câblage comptent, quelle que soit la forme de la carte.",
    prepare: "Vérifier le firmware",
    choose: "Choisir un port série",
    confirm: "Vérifier votre carte",
    install: "Installer et vérifier",
    cancel: "Annuler sans risque",
    retry: "Réessayer",
    connect: "Connecter à AirBridge",
    done: "Firmware vérifié. Prêt à connecter.",
    recovery:
      "En cas d’interruption : fermez les autres outils série. Maintenez BOOT, appuyez sur RESET, relâchez BOOT et choisissez le port de téléchargement pour réinstaller. Ne débranchez pas pendant l’écriture. Une installation partielle ne démarre pas.",
    releaseHelp:
      "Libération du port non confirmée. Patientez puis réessayez. Si le blocage persiste, fermez cet onglet, rebranchez la carte et rouvrez AirBridge.",
    busy: "Déconnectez le pont et terminez la libération du port avant l’installation.",
    warning:
      "Remplace l’application et la table de partitions. Utilisez une carte compatible de réserve. Les secteurs NVS sont préservés ; les données d’une autre application ne sont pas forcément compatibles.",
    provenance:
      "Version GitHub figée · SHA-256 avant ouverture du port · MD5 de la Flash après écriture.",
    memory:
      "Je confirme : PSRAM octale 8 Mo, Flash d’au moins 16 Mo et USB natif accessible. La ROM ne peut pas vérifier le câblage de la PSRAM externe.",
    usb: "La programmation accepte USB natif ou USB–UART. AirBridge v0.0.1 utilise USB Serial/JTAG natif : après programmation, utilisez le port relié à GPIO19/20 (303A:1001). Aucun port n’est choisi automatiquement.",
    download: "Échec du téléchargement. Vérifiez la connexion puis réessayez.",
    integrity:
      "Intégrité du firmware incorrecte. Aucun port ouvert. Rechargez le site officiel.",
    chip: "Cette image exige un ESP32-S3. Aucune écriture effectuée.",
    flash: "Au moins 16 Mo de Flash requis. Aucune écriture effectuée.",
    psram: "La PSRAM détectée est incompatible. Aucune écriture effectuée.",
    security:
      "Démarrage sécurisé, chiffrement ou téléchargement sécurisé configuré. Les appareils protégés ne sont pas modifiés.",
    serial:
      "Échec de communication série. Fermez les autres outils et suivez la procédure de récupération.",
    verify:
      "La relecture Flash ne correspond pas. Réinstallez avant de connecter.",
    reset:
      "Flash vérifiée, redémarrage non confirmé. Appuyez sur RESET puis réessayez.",
    release: "Libération du port non confirmée. Reconnexion bloquée.",
    loading: "Vérification de la version",
    ready: "Firmware prêt",
    choosing: "Choisissez un port dans le navigateur",
    inspecting: "Identification du chip et de la mémoire",
    writing: "Écriture du firmware",
    verifying: "Lecture des empreintes Flash",
    resetting: "Redémarrage de la carte",
    releasing: "Libération du port série",
    complete: "Vérifié et libéré",
    error: "Échec de l’installation",
    cancelled: "Annulé · aucun succès confirmé",
    cleanup_failed: "Libération nécessaire",
    idle: "Prêt à commencer",
    cancelling: "Annulation · attente de la commande en cours",
  },
  "zh-Hant": {
    title: "安裝橋接器韌體",
    intro: "從空白開發板開始使用 AirBridge，不必安裝 Python 或桌面程式。",
    requirements:
      "完整 AirBridge v0.0.1 · ESP32-S3 · 16 MB Flash · 8 MB 八線 PSRAM（N16R8）。外形不限，但記憶體與接線必須相容。",
    prepare: "檢查韌體",
    choose: "選擇序列埠",
    confirm: "核對開發板",
    install: "安裝並驗證",
    cancel: "安全取消",
    retry: "重試",
    connect: "連接 AirBridge",
    done: "韌體已驗證，可以連接。",
    recovery:
      "若中斷：關閉其他序列埠工具，按住 BOOT、短按 RESET、放開 BOOT，再選擇下載模式的序列埠重新安裝。寫入時請勿拔線；不完整的韌體無法啟動。",
    releaseHelp:
      "尚未確認序列埠釋放，請稍候再重試釋放。若仍阻塞，關閉本分頁，拔插開發板後重新開啟 AirBridge。",
    busy: "請先中斷橋接器連線，並完成序列埠清理，再安裝韌體。",
    warning:
      "將覆寫現有應用程式與分割表，請使用相容的備用開發板。不會抹除 NVS 磁區，但不保證其他應用程式的資料相容。",
    provenance:
      "固定 GitHub 發布版本 · 開埠前檢查 SHA-256 · 寫入後讀取晶片 Flash 的 MD5 核對。",
    memory:
      "我確認此板具有 8 MB 八線 PSRAM、至少 16 MB Flash，以及可用的原生 USB。ROM 無法證實外接 PSRAM 的接線。",
    usb: "可透過原生 USB 或 USB–UART 燒錄。AirBridge v0.0.1 執行時使用原生 USB Serial/JTAG；燒錄後請接 GPIO19/20 對應的 USB 埠（303A:1001）。不會自動選擇序列埠。",
    download: "韌體下載失敗，請檢查連線並重試。",
    integrity: "韌體完整性檢查失敗，未開啟序列埠。請重新載入官方網站。",
    chip: "此韌體僅適用 ESP32-S3，未寫入 Flash。",
    flash: "需要至少 16 MB Flash，未寫入 Flash。",
    psram: "偵測到的 PSRAM 與韌體不相容，未寫入 Flash。",
    security:
      "裝置已設定安全啟動、Flash 加密或安全下載，本安裝器不修改受保護的裝置。",
    serial: "序列埠通訊失敗，請關閉其他工具並依照復原步驟操作。",
    verify: "Flash 讀回摘要不一致，安裝未完成，請重新安裝再連接。",
    reset: "Flash 已驗證，但無法確認重啟。請手動按 RESET 後重試。",
    release: "無法確認序列埠釋放，已阻止重新連線。",
    loading: "正在檢查發布內容",
    ready: "韌體已備妥",
    choosing: "請在瀏覽器選擇序列埠",
    inspecting: "正在識別晶片與記憶體",
    writing: "正在寫入韌體",
    verifying: "正在讀取 Flash 摘要",
    resetting: "正在重新啟動",
    releasing: "正在釋放序列埠",
    complete: "已驗證並釋放",
    error: "安裝失敗",
    cancelled: "已取消 · 未宣告成功",
    cleanup_failed: "需要清理序列埠",
    idle: "準備開始",
    cancelling: "正在取消 · 等待目前指令結束",
  },
  ar: {
    title: "تثبيت برنامج الجسر",
    intro: "من لوحة فارغة إلى AirBridge دون Python أو برنامج مكتبي.",
    requirements:
      "AirBridge الكامل v0.0.1 · ESP32-S3 · ذاكرة Flash بسعة 16 MB وPSRAM ثمانية الخطوط بسعة 8 MB ‏(N16R8). شكل اللوحة لا يهم، لكن الذاكرة والتوصيل مهمان.",
    prepare: "فحص البرنامج",
    choose: "اختيار المنفذ التسلسلي",
    confirm: "مراجعة اللوحة",
    install: "تثبيت والتحقق",
    cancel: "إلغاء بأمان",
    retry: "إعادة المحاولة",
    connect: "الاتصال بـ AirBridge",
    done: "تم التحقق من البرنامج. جاهز للاتصال.",
    recovery:
      "عند الانقطاع: أغلق البرامج التسلسلية الأخرى. اضغط مطولاً على BOOT ثم اضغط RESET واترك BOOT، واختر منفذ التنزيل وأعد التثبيت. لا تفصل الكابل أثناء الكتابة. التثبيت الجزئي لا يعمل.",
    releaseHelp:
      "لم يتأكد تحرير المنفذ. انتظر وأعد محاولة التحرير. إذا استمر الحظر، أغلق علامة التبويب وأعد توصيل اللوحة وافتح AirBridge.",
    busy: "افصل الجسر وأكمل تحرير المنفذ قبل التثبيت.",
    warning:
      "سيستبدل التطبيق وجدول الأقسام. استخدم لوحة احتياطية متوافقة. لن تمحى قطاعات NVS، لكن توافق بيانات التطبيقات الأخرى غير مضمون.",
    provenance:
      "إصدار GitHub ثابت · فحص SHA-256 قبل فتح المنفذ · فحص MD5 من Flash بعد الكتابة.",
    memory:
      "أؤكد وجود PSRAM ثمانية الخطوط بسعة 8 MB وFlash بسعة 16 MB على الأقل ومنفذ USB أصلي متاح. لا تستطيع ROM إثبات توصيل PSRAM الخارجية.",
    usb: "يمكن التثبيت عبر USB الأصلي أو USB–UART. يعمل AirBridge v0.0.1 عبر USB Serial/JTAG الأصلي: استخدم منفذ GPIO19/20 ‏(303A:1001) بعد التثبيت. لا يتم اختيار المنفذ تلقائياً.",
    download: "فشل تنزيل البرنامج. افحص الاتصال وأعد المحاولة.",
    integrity:
      "فشل فحص سلامة البرنامج. لم يفتح أي منفذ. أعد تحميل الموقع الرسمي.",
    chip: "هذه الصورة مخصصة لـ ESP32-S3 فقط. لم تكتب Flash.",
    flash: "يلزم Flash بسعة 16 MB على الأقل. لم تكتب Flash.",
    psram: "ذاكرة PSRAM المكتشفة غير متوافقة. لم تكتب Flash.",
    security:
      "الجهاز محمي بإقلاع آمن أو تشفير أو تنزيل آمن. لن يعدل المثبت الأجهزة المحمية.",
    serial: "فشل الاتصال التسلسلي. أغلق الأدوات الأخرى واتبع خطوات الاستعادة.",
    verify: "لم تتطابق قراءة Flash. أعد التثبيت قبل الاتصال.",
    reset:
      "تم التحقق من Flash ولم يتأكد التشغيل. اضغط RESET يدوياً وأعد المحاولة.",
    release: "لم يتأكد تحرير المنفذ. إعادة الاتصال محظورة.",
    loading: "فحص الإصدار",
    ready: "البرنامج جاهز",
    choosing: "اختر منفذاً من المتصفح",
    inspecting: "التعرف على الشريحة والذاكرة",
    writing: "كتابة البرنامج",
    verifying: "قراءة بصمات Flash",
    resetting: "إعادة تشغيل اللوحة",
    releasing: "تحرير المنفذ",
    complete: "تم التحقق والتحرير",
    error: "فشل التثبيت",
    cancelled: "ألغي · دون تأكيد النجاح",
    cleanup_failed: "يلزم تحرير المنفذ",
    idle: "جاهز للبدء",
    cancelling: "جارٍ الإلغاء · انتظار الأمر الحالي",
  },
};
export const phaseText = (copy: FlashCopy, phase: Phase) => copy[phase];
export const failureText = (copy: FlashCopy, error: Failure) => copy[error];
