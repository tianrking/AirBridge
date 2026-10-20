import { useEffect, useState, useSyncExternalStore } from "react";
import { Cpu, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import { translations } from "./i18n";
import { firmwareMessages, phaseText, failureText } from "./locales/flasher";
import { firmwareInstaller } from "./web/firmware-installer";
import { browserSupport } from "./web/platform";
import { accessTranslations } from "./i18n";
import {
  firmwareRelease,
  ownsFlash,
  type FirmwareInstaller,
} from "./web/flasher";
import type { Language } from "./types";
export function FirmwareSetup({
  language,
  hostIdle,
  onConnect,
  installer = firmwareInstaller,
}: {
  language: Language;
  hostIdle: boolean;
  onConnect(): void;
  installer?: FirmwareInstaller;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const state = useSyncExternalStore(
    installer.subscribe,
    installer.getSnapshot,
  );
  const copy = firmwareMessages[language];
  const owns = ownsFlash(state);
  const support = browserSupport(true);
  const busy =
    owns && state.phase !== "confirm" && state.phase !== "cleanup_failed";
  useEffect(() => {
    setConfirmed(false);
  }, [state.board]);
  useEffect(() => {
    if (!owns) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [owns]);
  const close = () => {
    if (!owns && state.phase !== "loading") setOpen(false);
  };
  return (
    <>
      <button
        className="text-button firmware-entry"
        onClick={() => setOpen(true)}
      >
        <Cpu size={16} />
        {copy.title}
      </button>
      {open && (
        <Dialog
          title={copy.title}
          eyebrow={`ESP32-S3 · v${firmwareRelease.version}`}
          icon={<Cpu size={25} />}
          copy={translations[language]}
          onClose={close}
          dismissible={!owns && state.phase !== "loading"}
        >
          <div className="firmware-setup">
            <p>{copy.intro}</p>
            <div className="firmware-profile">
              <ShieldCheck size={21} />
              <p>{copy.requirements}</p>
            </div>
            <p>{copy.usb}</p>
            {support && (
              <p role="alert" className="firmware-warning">
                {accessTranslations[language].issues[support]}
              </p>
            )}
            {!hostIdle && !owns && (
              <p role="alert" className="firmware-warning">
                {copy.busy}
              </p>
            )}
            <div
              className={`firmware-status ${state.phase === "complete" ? "verified" : ""}`}
              role="status"
              aria-live="polite"
            >
              {state.phase === "complete" ? (
                <CheckCircle2 size={20} />
              ) : busy || state.phase === "loading" ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <Cpu size={20} />
              )}
              <strong>{phaseText(copy, state.phase)}</strong>
            </div>
            {state.board && (
              <dl className="firmware-board">
                <div>
                  <dt>Chip</dt>
                  <dd>
                    <bdi>{state.board.chip}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>Flash</dt>
                  <dd>
                    <bdi>{state.board.flashBytes / 1048576} MB</bdi>
                  </dd>
                </div>
                <div>
                  <dt>ROM</dt>
                  <dd>
                    <bdi>{state.board.features.join(" · ") || "—"}</bdi>
                  </dd>
                </div>
              </dl>
            )}
            {[
              "writing",
              "verifying",
              "resetting",
              "releasing",
              "complete",
            ].includes(state.phase) && (
              <progress
                aria-label={phaseText(copy, state.phase)}
                value={state.progress}
                max={1}
              />
            )}
            {state.error && (
              <div role="alert" className="firmware-warning">
                <p>{failureText(copy, state.error)}</p>
                {state.detail && <code dir="ltr">{state.detail}</code>}
              </div>
            )}
            {state.phase === "confirm" && (
              <>
                <p className="firmware-warning">{copy.warning}</p>
                <label className="firmware-consent">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>{copy.memory}</span>
                </label>
              </>
            )}
            {state.phase === "complete" && <p>{copy.done}</p>}
            {state.phase === "cleanup_failed" ? (
              <p>{copy.releaseHelp}</p>
            ) : (
              <p className="firmware-recovery">{copy.recovery}</p>
            )}
            <a
              className="firmware-provenance"
              href={firmwareRelease.release}
              target="_blank"
              rel="noreferrer"
            >
              {copy.provenance}
            </a>
            <div className="dialog-actions firmware-actions">
              {!owns &&
                state.phase !== "loading" &&
                state.phase !== "complete" && (
                  <button
                    className="secondary"
                    disabled={!!support || !hostIdle}
                    onClick={() => void installer.prepare()}
                  >
                    {state.phase === "idle" ? copy.prepare : copy.retry}
                  </button>
                )}
              {state.phase === "ready" && (
                <button
                  className="primary"
                  disabled={!!support || !hostIdle}
                  onClick={() => void installer.choose()}
                >
                  {copy.choose}
                </button>
              )}
              {state.phase === "confirm" && (
                <button
                  className="primary"
                  disabled={!confirmed}
                  onClick={() => void installer.install(confirmed)}
                >
                  {copy.install}
                </button>
              )}
              {owns && state.phase !== "cleanup_failed" && (
                <button
                  className="secondary"
                  disabled={
                    state.phase === "releasing" || state.phase === "cancelling"
                  }
                  onClick={() => void installer.cancel()}
                >
                  {copy.cancel}
                </button>
              )}
              {state.phase === "cleanup_failed" && (
                <button
                  className="secondary"
                  onClick={() => void installer.retryRelease()}
                >
                  {translations[language].retryRelease}
                </button>
              )}
              {state.phase === "complete" && (
                <>
                  <button
                    className="secondary"
                    onClick={() => void installer.prepare()}
                  >
                    {copy.retry}
                  </button>
                  <button
                    className="primary"
                    disabled={!hostIdle || !!support}
                    onClick={() => {
                      setOpen(false);
                      onConnect();
                    }}
                  >
                    {copy.connect}
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
