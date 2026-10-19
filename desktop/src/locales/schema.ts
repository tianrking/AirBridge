import type en from "./en";
import type { SupportCode } from "../web/platform";

// English defines the contract. Locales must implement it in full, without a
// silent English fallback hiding untranslated or missing interface messages.
export type Copy = { [Key in keyof typeof en.ui]: string };
export interface LocaleMessages {
  ui: Copy;
  web: { [Key in keyof typeof en.web]: string };
  access: {
    ready: string;
    attention: string;
    compatible: string;
    details: string;
    privacy: string;
    steps: [string, string, string];
    denied: string;
    full: string;
    issues: Record<SupportCode, string>;
  };
  files: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
}
