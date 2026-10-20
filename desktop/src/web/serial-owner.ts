// Both features acquire synchronously, before opening a browser chooser.
let flashOwner: object | undefined;
export function assertHostAvailable() {
  if (flashOwner)
    throw new Error(
      "Firmware installer owns the serial connection; release it first",
    );
}
export function claimFlash(owner: object, hostIdle: () => boolean) {
  if (flashOwner || !hostIdle())
    throw new Error("Disconnect the bridge and finish port cleanup first");
  flashOwner = owner;
}
export function releaseFlash(owner: object) {
  if (flashOwner === owner) flashOwner = undefined;
}
