import { FeatureHubContent } from "@/components/feature-hub/feature-hub-panel";
import type { FeatureHubSection } from "@/components/feature-hub/hub-tab-ref";
import { Modal } from "@/components/ui/modal";
import { useFeatures } from "@/hooks/use-features";

/**
 * Thin responsive modal shell over {@link FeatureHubContent} for 0-thread,
 * parked, and sidebar-launched Features.
 */
export function FeatureHubModal({
  open,
  featureId,
  initialSection,
  initialDirectory,
  onClose,
}: {
  readonly open: boolean;
  readonly featureId: string | null;
  readonly initialSection?: FeatureHubSection;
  readonly initialDirectory?: string | null;
  readonly onClose: () => void;
}) {
  const api = useFeatures();
  const feature = featureId === null ? null : (api.byId.get(featureId) ?? null);

  if (!open || featureId === null) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="Layers"
      width="56rem"
      className="h-[80vh] max-h-[85vh]"
      bodyClassName="flex flex-col overflow-hidden p-0"
      title={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{feature?.name ?? "Feature Hub"}</span>
          {feature?.state === "parked" ? (
            <span className="harbor-badge-warning shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
              Parked
            </span>
          ) : null}
        </span>
      }
      subtitle={<span className="font-mono">{feature?.slug ?? featureId}</span>}
    >
      <FeatureHubContent
        featureId={featureId}
        initialSection={initialSection}
        initialDirectory={initialDirectory}
        hideHeader
        onClose={onClose}
      />
    </Modal>
  );
}
