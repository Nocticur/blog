import { AiUpstreamError } from "../errors";

function parseContent(data: string): string | null {
	if (data === "[DONE]") return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw new AiUpstreamError("AI provider returned an invalid stream event");
	}
	if (!parsed || typeof parsed !== "object") return null;

	const choices = Reflect.get(parsed, "choices");
	if (
		!Array.isArray(choices) ||
		!choices[0] ||
		typeof choices[0] !== "object"
	) {
		return null;
	}
	const delta = Reflect.get(choices[0], "delta");
	if (!delta || typeof delta !== "object") return null;
	const content = Reflect.get(delta, "content");
	return typeof content === "string" ? content : null;
}

function parseLine(line: string): { done: boolean; content: string | null } {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith(":")) {
		return { done: false, content: null };
	}
	if (!trimmed.startsWith("data:")) {
		return { done: false, content: null };
	}

	const data = trimmed.slice(5).trimStart();
	if (data === "[DONE]") return { done: true, content: null };
	return { done: false, content: parseContent(data) };
}

export async function* readOpenAiTextStream(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				buffer += decoder.decode();
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const event = parseLine(line);
				if (event.done) return;
				if (event.content) yield event.content;
			}
		}

		if (buffer) {
			const event = parseLine(buffer);
			if (!event.done && event.content) yield event.content;
		}
	} finally {
		if (!completed) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
