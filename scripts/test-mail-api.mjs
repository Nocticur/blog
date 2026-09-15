import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
	createMailbox,
	getMailboxMessages,
	getMailMessage,
	MailApiError,
} from "../src/utils/mail-api.ts";

afterEach(() => mock.restoreAll());

test("normalizes D1 integer unread flags", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({
			results: [
				{ id: 1, is_unread: 1 },
				{ id: 2, is_unread: 0 },
			],
			count: 2,
		}),
	);
	const result = await getMailboxMessages("test-token");
	assert.deepEqual(
		result.results.map((item) => item.is_unread),
		[true, false],
	);
});

test("missing detail produces a readable 404", async () => {
	mock.method(globalThis, "fetch", async () => Response.json(null));
	await assert.rejects(
		getMailMessage("42", "test-token"),
		(error) => error instanceof MailApiError && error.status === 404,
	);
});

test("null mailbox response produces a service error", async () => {
	mock.method(globalThis, "fetch", async () => Response.json(null));
	await assert.rejects(
		createMailbox(),
		(error) => error instanceof MailApiError && error.status === 502,
	);
});

test("HTML success response is not silently shown as an empty inbox", async () => {
	mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response("<!doctype html><h1>Wrong route</h1>", {
				headers: { "content-type": "text/html" },
			}),
	);
	await assert.rejects(
		getMailboxMessages("test-token"),
		(error) =>
			error instanceof MailApiError && error.code === "INVALID_RESPONSE",
	);
});

test("challenge page is distinguished from expired authentication", async () => {
	mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response("<html>Just a moment...</html>", {
				status: 403,
				headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
			}),
	);
	await assert.rejects(
		getMailboxMessages("test-token"),
		(error) =>
			error instanceof MailApiError &&
			error.code === "UPSTREAM_CHALLENGE" &&
			!error.message.includes("<html>"),
	);
});

test("backend error property is preserved", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ error: "No address" }, { status: 400 }),
	);
	await assert.rejects(getMailboxMessages("test-token"), {
		message: "No address",
	});
});

test("request retains API path, bearer and abort signal", async () => {
	const controller = new AbortController();
	mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, "/api/parsed_mails?limit=30&offset=0");
		assert.equal(init.headers.get("authorization"), "Bearer test-token");
		assert.equal(init.signal, controller.signal);
		return Response.json({ results: [], count: 0 });
	});
	assert.deepEqual(await getMailboxMessages("test-token", controller.signal), {
		results: [],
		count: 0,
	});
});
