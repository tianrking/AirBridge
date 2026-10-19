import {
  ArrowUpRight,
  Check,
  CircleHelp,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { browserSupport } from "./web/platform";
import { accessTranslations as copy } from "./i18n";
import type { Language } from "./types";
import "./browser-access.css";

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
