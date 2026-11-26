import { ThreadCard } from "@/components/inbox/thread-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import type { ThreadFamily } from "@/lib/domain/inbox";

export function FamilyRow({
  family,
  projectId,
  pinned = false,
}: {
  family: ThreadFamily;
  projectId: string;
  pinned?: boolean;
}) {
  return <ThreadCard family={family} projectId={projectId} pinned={pinned} />;
}

export function FlatFamilies({
  families,
  projectId,
}: {
  families: readonly ThreadFamily[];
  projectId: string;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  return (
    <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
      {families.map((family) => (
        <FamilyRow key={family.root.id} family={family} projectId={projectId} />
      ))}
    </ul>
  );
}
