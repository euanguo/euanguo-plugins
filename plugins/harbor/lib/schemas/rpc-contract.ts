import type { defineRpcContract as SdkDefineRpcContract } from "@get-bb/plugin-sdk";

/**
 * Browser-safe identity helper mirroring `@get-bb/plugin-sdk`'s `defineRpcContract`.
 *
 * `@get-bb/plugin-sdk`'s root entry is server-only and rejected by BB's browser
 * bundler on newer SDKs (0.6.189+), whereas `defineRpcContract` is a runtime
 * identity function (`(contract) => contract`). Using `import type` preserves
 * exact SDK contract type inference with zero root-SDK runtime import.
 */
export const defineRpcContract: typeof SdkDefineRpcContract = ((
  contract: Parameters<typeof SdkDefineRpcContract>[0],
) => contract) as typeof SdkDefineRpcContract;
