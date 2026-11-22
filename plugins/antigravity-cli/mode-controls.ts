import type { AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

// Keep native mode IDs so the shared bridge can apply the selection unchanged.
function workModes(options: NonNullable<AvailableModel["sessionOptions"]>) {
  return options.map(option => option.id !== "mode" || option.type !== "select" || !["plan", "accept-edits"].every(id => option.values.some(value => value.id === id)) ? option : {
    ...option,
    label: "Mode",
    value: option.value === "plan" ? "plan" : "accept-edits",
    values: [
      { id: "accept-edits", label: "Build", description: "Implement the task using the selected permission policy." },
      { id: "plan", label: "Plan", description: "Research and plan before implementation. Not enforced read-only access." },
    ],
  });
}

export function presentModeControls(line: string): string {
  let message;
  try { message = JSON.parse(line); } catch { return line; }
  if (Array.isArray(message?.result?.models)) {
    for (const model of [...message.result.models, ...(Array.isArray(message.result.selectedOnlyModels) ? message.result.selectedOnlyModels : [])]) {
      if (Array.isArray(model.sessionOptions)) model.sessionOptions = workModes(model.sessionOptions);
    }
  }
  for (const delta of Array.isArray(message?.params?.deltas) ? message.params.deltas : []) {
    if (delta.kind === "extension.state" && delta.extensionKind === "bb/session-options" && Array.isArray(delta.payload?.options)) {
      delta.payload.options = workModes(delta.payload.options);
    }
  }
  return JSON.stringify(message);
}

// The bridge has no output hook; adapt only this dedicated bridge process's JSONL transport.
export function modeControlOutput(
  intercept?: (line: string) => boolean,
  transformLines?: (line: string) => string[],
) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const emit = (stream: Transform, line: string, trailingNewline: boolean) => {
    const modeLine = presentModeControls(line);
    const lines = transformLines ? transformLines(modeLine) : [modeLine];
    for (const out of lines) {
      stream.push(trailingNewline ? `${out}\n` : out);
    }
  };
  return new Transform({
    transform(chunk, _encoding, done) {
      pending += decoder.write(chunk);
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        if (!intercept?.(line)) emit(this, line, true);
        pending = pending.slice(end + 1);
      }
      done();
    },
    flush(done) {
      pending += decoder.end();
      if (pending && !intercept?.(pending)) emit(this, pending, false);
      done();
    },
  });
}
