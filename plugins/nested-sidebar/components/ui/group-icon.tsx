import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { cn } from "@/lib/utils";
import {
  loadGroupIcon,
  type GroupIconTransport,
} from "@/lib/group-icon-loader";
import {
  canonicalGroupIcon,
  normalizeGroupIconName,
  type GroupIconName,
} from "@/lib/group-icons";

/**
 * Renders any free Hugeicons export the picker offers.
 *
 * The artwork is not in this bundle, and must not be. It is 6 MB of path data
 * for six thousand icons, and a plugin frontend is a single bundle that bb
 * loads on every window's deferred plugin boot — so inlining it charged the
 * sidebar 6.1 MB for a picker most sessions never open. `@hugeicons`' own
 * loader cannot help: it resolves through a static import map, and with code
 * splitting off every entry of that map is inlined too.
 *
 * So the artwork lives in the plugin's files and is fetched on demand, batched
 * and cached by `lib/group-icon-loader`. What is left in the bundle is the name
 * list, which is what the picker searches and what stored rows are validated
 * against.
 */
export function GroupIcon({
  name,
  className,
  ariaHidden,
  ariaLabel,
  defer = false,
}: {
  name: GroupIconName;
  className?: string;
  ariaHidden?: boolean | "true" | "false";
  ariaLabel?: string;
  defer?: boolean;
}) {
  const canonical = canonicalGroupIcon(name);
  const rpc = useRpc<typeof nestRpcContract>();
  const transport = useCallback<GroupIconTransport>(
    (names) =>
      rpc
        .call("getGroupIcons", { names: [...names] })
        .then((result) => result.icons),
    [rpc],
  );
  return defer ? (
    <DeferredGroupIcon
      transport={transport}
      name={canonical}
      className={className}
      ariaHidden={ariaHidden}
      ariaLabel={ariaLabel}
    />
  ) : (
    <ResolvedGroupIcon
      transport={transport}
      name={canonical}
      className={className}
      ariaHidden={ariaHidden}
      ariaLabel={ariaLabel}
    />
  );
}

function DeferredGroupIcon(props: {
  transport: GroupIconTransport;
  name: string;
  className?: string;
  ariaHidden?: boolean | "true" | "false";
  ariaLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const target = ref.current;
    if (target === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={cn("inline-flex shrink-0", props.className)}>
      {visible ? <ResolvedGroupIcon {...props} /> : null}
    </span>
  );
}

function ResolvedGroupIcon({
  transport,
  name,
  className,
  ariaHidden,
  ariaLabel,
}: {
  transport: GroupIconTransport;
  name: string;
  className?: string;
  ariaHidden?: boolean | "true" | "false";
  ariaLabel?: string;
}) {
  const [icon, setIcon] = useState<IconSvgElement | null>(null);
  const resolvedName = normalizeGroupIconName(name);

  /**
   * The transport is read through a ref, and the load below does not depend on
   * it. React is free to hand out a new RPC client object on any render, and an
   * effect that re-ran whenever it did would clear the icon and ask again on
   * every one of them.
   */
  const transportRef = useRef(transport);
  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  useEffect(() => {
    let current = true;
    setIcon(null);
    if (resolvedName === null) return () => undefined;
    void loadGroupIcon(transportRef.current, resolvedName).then((loaded) => {
      if (current) setIcon(loaded);
    });
    return () => {
      current = false;
    };
  }, [resolvedName]);

  if (icon === null) {
    return <span aria-hidden className={cn("inline-block", className)} />;
  }
  return (
    <HugeiconsIcon
      icon={icon}
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
