function contentText(content: any): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => part.type === "text" ? part.text : `[${part.type}]`).join("\n") : "";
}

// Parse only observable RPC activity, not hidden reasoning or model context.
export class ActivityParser {
  private streamed = false;

  parse(line: string): string {
    let event: any;
    try { event = JSON.parse(line); } catch { return line + "\n"; }
    if (!event || typeof event !== "object") return line + "\n";
    switch (event.type) {
      case "agent_start": return "[Agent started]\n";
      case "message_start":
        if (event.message?.role === "assistant") { this.streamed = false; return "\n[Assistant]\n"; }
        return "";
      case "message_update":
        if (event.assistantMessageEvent?.type === "text_delta") {
          this.streamed = true;
          return event.assistantMessageEvent.delta;
        }
        return "";
      case "message_end":
        if (event.message?.role === "assistant") {
          const text = this.streamed ? "" : contentText(event.message.content);
          return text + (event.message.errorMessage ? `\n[Error] ${event.message.errorMessage}` : "") + "\n";
        }
        if (event.message?.role === "custom" && event.message.customType === "pueue-completion") {
          return `\n[Task completion]\n${event.message.details?.summary ?? contentText(event.message.content)}\n`;
        }
        return "";
      case "tool_execution_start": return `\n[Tool] ${event.toolName} ${JSON.stringify(event.args)}\n`;
      case "tool_execution_end": return `\n[${event.isError ? "Tool error" : "Result"}] ${event.toolName}\n${contentText(event.result?.content)}\n`;
      case "agent_end": return "\n[Agent run ended]\n";
      case "extension_error": return `[Error] ${event.error}\n`;
      case "response": return event.success === false ? `[Error] ${event.error}\n` : "";
      case "extension_ui_request": return event.method === "notify" ? `[Notice] ${event.message}\n` : "";
      case "entry_appended":
        if (event.entry?.customType === "pueue-subagent-exit") {
          return event.entry.data?.success ? "[Subagent finished]\n" : `[Subagent failed] ${event.entry.data?.error}\n`;
        }
        return "";
      default: return "";
    }
  }
}
