import type { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";

export type AppSdk = ReturnType<typeof useSdk>;
export type AppNavigate = ReturnType<typeof useBbNavigate>;

interface AppBridge {
  readonly sdk: AppSdk;
  readonly navigate: AppNavigate;
}

let current: AppBridge | null = null;

export function setAppBridge(bridge: AppBridge | null): void {
  current = bridge;
}

export function getAppBridge(): AppBridge {
  if (current === null) {
    throw new Error("Harbor is still loading. Try again.");
  }
  return current;
}
