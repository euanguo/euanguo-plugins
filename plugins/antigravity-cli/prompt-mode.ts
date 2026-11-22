// ACP combines planning and approval policy in a single native mode.
export function mapPromptMode(line: string, parsedLine?: unknown): string {
  let request: any = parsedLine;
  if (arguments.length < 2) {
    try { request = JSON.parse(line); } catch { return line; }
  }
  if (request?.method !== "turn/start" || !request.params?.options) return line;
  const options = request.params.options;
  options.sessionOptions = {
    ...options.sessionOptions,
    mode: options.sessionOptions?.mode === "plan" || (options.sessionOptions?.mode !== "accept-edits" && options.promptMode === "plan") ? "plan" : "accept-edits",
  };
  return JSON.stringify(request);
}
