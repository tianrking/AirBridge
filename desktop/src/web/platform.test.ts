import { expect, it } from "vitest";
import { supportCode } from "./platform";

const available = {
  secure: true,
  embedded: false,
  policy: true,
  serial: true,
  storage: true,
};
it.each([
  [{}, null],
  [{ secure: false }, "insecure"],
  [{ embedded: true }, "embedded"],
  [{ policy: false }, "policy"],
  [{ serial: false }, "serial"],
  [{ storage: false }, "storage"],
] as const)(
  "detects compatibility without opening hardware: %j",
  (overrides, result) => {
    expect(supportCode({ ...available, ...overrides })).toBe(result);
  },
);
