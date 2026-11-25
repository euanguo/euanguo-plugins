export function commitReorder(
  write: Promise<boolean>,
  input: {
    readonly success: string;
    readonly failure: string;
    readonly announce: (message: string) => void;
  },
): void {
  void write
    .then((ok) => input.announce(ok ? input.success : input.failure))
    .catch(() => input.announce(input.failure));
}
