import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import { errorMessage } from "@/lib/domain/rpc-error";
import {
  FEATURE_CHANNEL,
  GROUP_CHANNEL,
  NEST_MIGRATION_CHANNEL,
} from "@/lib/realtime-channels";
import type {
  NestMigrationApplyInput,
  NestMigrationApplyResult,
  NestMigrationPreview,
} from "@/lib/schemas/settings";
import type { harborRpcContract } from "@/server/contract";

export interface NestMigrationApi {
  readonly preview: NestMigrationPreview | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly apply: (
    input: NestMigrationApplyInput,
  ) => Promise<NestMigrationApplyResult>;
  readonly dismissTip: () => Promise<void>;
}

/**
 * Loads dry-run migration state from sibling Nest storage and provides
 * explicit one-click apply and tip-dismissal actions.
 */
export function useNestMigration(): NestMigrationApi {
  const rpc = useRpc<typeof harborRpcContract>();
  const [preview, setPreview] = useState<NestMigrationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("previewNestMigration", {})
      .then((next) => {
        if (cancelled) return;
        setPreview(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(errorMessage(caught, "Could not inspect Nest migration data."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, rpc]);

  useCoalescedRealtime(NEST_MIGRATION_CHANNEL, refresh);
  useCoalescedRealtime(GROUP_CHANNEL, refresh);
  useCoalescedRealtime(FEATURE_CHANNEL, refresh);

  const apply = useCallback(
    async (input: NestMigrationApplyInput) => {
      setBusy(true);
      setError(null);
      try {
        const result = await rpc.call("applyNestMigration", input);
        setPreview(result.preview);
        return result;
      } catch (caught: unknown) {
        const msg = errorMessage(caught, "Could not migrate Nest data.");
        setError(msg);
        throw new Error(msg);
      } finally {
        setBusy(false);
      }
    },
    [rpc],
  );

  const dismissTip = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc.call("dismissNestMigrationTip", {});
      setPreview((current) =>
        current === null ? null : { ...current, tipDismissed: true, showTip: false },
      );
    } catch (caught: unknown) {
      setError(errorMessage(caught, "Could not dismiss migration tip."));
    } finally {
      setBusy(false);
    }
  }, [rpc]);

  return { preview, loading, busy, error, refresh, apply, dismissTip };
}
