import { AiUpstreamError } from "@/server/ai-search/errors";

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

	let payload: unknown;
	try {
		payload = JSON.parse(data);
	} catch {
		throw new AiUpstreamError("Workers AI returned an invalid stream event");
	}
	if (!payload || typeof payload !== "object") {
		return { done: false, content: null };
	}
	const response = Reflect.get(payload, "response");
	return {
		done: false,
		content: typeof response === "string" ? response : null,
	};
}

export async function* readWorkersAiTextStream(
	stream: ReadableStream<Uint8Array | string>,
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
			buffer +=
				typeof value === "string"
					? value
					: decoder.decode(value, { stream: true });
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
