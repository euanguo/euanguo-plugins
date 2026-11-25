import { useEffect } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";

import { setAppBridge } from "@/app/bridge";

/** Publishes the SDK and navigate handles to the non-React slots. */
export function AppBridgeOverlay() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  useEffect(() => {
    setAppBridge({ sdk, navigate });
    return () => setAppBridge(null);
  }, [navigate, sdk]);
  return null;
}
