/**
 * The backend's source, assembled the way the plugin assembles it.
 *
 * A handful of tests assert on the *text* of a handler — that the unarchive
 * retry retries exactly twice, that a settle reports whether the archive
 * landed — because those are ordering and shape claims that a unit test on the
 * pure helpers cannot see. Those handlers used to live in `server.ts`; they are
 * now one module per subject under `server/rpc/`.
 *
 * Reading them through this helper rather than naming a file keeps the
 * assertion where it belongs: on what the backend does, not on where the text
 * happens to sit. A handler that moves again does not need every test that
 * mentions it edited.
 */
import { readFile, readdir } from "node:fs/promises";

const here = new URL("../", import.meta.url);

export async function readBackend(): Promise<string> {
  const [entry, contract, ...rpc] = await Promise.all([
    readFile(new URL("server.ts", here), "utf8"),
    readFile(new URL("server/contract.ts", here), "utf8"),
    readdir(new URL("server/rpc/", here)).then((names) =>
      Promise.all(
        names
          .filter((name) => name.endsWith(".ts"))
          .sort()
          .map((name) => readFile(new URL(`server/rpc/${name}`, here), "utf8")),
      ),
    ),
  ]);
  return [entry, contract, ...rpc].join("\n");
}

/** Just the handler modules, without the entry point or the contract. */
export async function readHandlers(): Promise<string> {
  const names = (await readdir(new URL("server/rpc/", here)))
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const files = await Promise.all(
    names.map((name) => readFile(new URL(`server/rpc/${name}`, here), "utf8")),
  );
  return files.join("\n");
}
