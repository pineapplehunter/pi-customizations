export interface Task {
  id: number;
  command: string;
  original_command?: string;
  label?: string | null;
  group: string;
  path?: string;
  status: string | { Done?: { start?: string; end: string; result: unknown } };
}

// Optional, synchronous hooks on pi.events. Integrations mutate presentation
// objects before they are used; the core never depends on a listener being there.
export interface CompletionFormat {
  task: Task;
  content: string;
  summary: string;
}

export interface LogFormat {
  task: Task;
  name: string;
  mode: string;
  parseLine?: (line: string) => string;
}

export interface QueueState {
  ready: boolean; // Terminal tasks AND completion results processed by a completed run.
  error?: string;
}

export function inlineCode(text: string): string {
  const ticks = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return `${ticks} ${text} ${ticks}`;
}
