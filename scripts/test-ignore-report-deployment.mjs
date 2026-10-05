import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./ignore-report-deployment.mjs", import.meta.url));

async function repository(t) {
	const directory = await mkdtemp(path.join(tmpdir(), "blog-report-deployment-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", args, {
		cwd: directory,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	git("init", "--initial-branch=master");
	git("config", "user.name", "Deployment Test");
	git("config", "user.email", "deployment-test@example.invalid");
	async function commit(files, message) {
		for (const [name, content] of Object.entries(files)) {
			const filename = path.join(directory, name);
			await mkdir(path.dirname(filename), { recursive: true });
			await writeFile(filename, content);
		}
		git("add", "--all");
		git("commit", "--quiet", "-m", message);
		return git("rev-parse", "HEAD");
	}
	function run(previousSha) {
		const env = { ...process.env };
		delete env.VERCEL_GIT_PREVIOUS_SHA;
		if (previousSha !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = previousSha;
		const result = spawnSync(process.execPath, [script], {
			cwd: directory,
			env,
			encoding: "utf8",
		});
		assert.equal(result.error, undefined);
		return result;
	}
	return { commit, git, run };
}

test("ignores a deployment when only the report changed since the successful deployment", async (t) => {
	const repo = await repository(t);
	const deployed = await repo.commit({ "src/app.js": "export const version = 1;\n" }, "Initial app");
	await repo.commit({ "reports/friend-links.json": '{"checkedAt":"2026-10-05"}\n' }, "Update report");
	const result = repo.run(deployed);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /report/i);
});

test("builds when a report commit also changes code", async (t) => {
	const repo = await repository(t);
	const deployed = await repo.commit({ "src/app.js": "version 1\n" }, "Initial app");
	await repo.commit({ "src/app.js": "version 2\n", "reports/friend-links.json": "{}\n" }, "App and report");
	assert.equal(repo.run(deployed).status, 1);
});

test("builds when earlier undeployed code is followed by a report-only commit", async (t) => {
	const repo = await repository(t);
	const deployed = await repo.commit({ "src/app.js": "version 1\n" }, "Initial app");
	await repo.commit({ "src/app.js": "version 2\n" }, "Undeployed app change");
	await repo.commit({ "reports/friend-links.json": "{}\n" }, "Update report");
	assert.equal(repo.run(deployed).status, 1);
});

test("builds for a first commit without a previous successful deployment", async (t) => {
	const repo = await repository(t);
	await repo.commit({ "reports/friend-links.json": "{}\n" }, "Initial report");
	assert.equal(repo.run().status, 1);
});

test("builds when the previous deployment SHA is unavailable despite a report-only parent diff", async (t) => {
	const repo = await repository(t);
	await repo.commit({ "src/app.js": "version 1\n" }, "Initial app");
	await repo.commit({ "reports/friend-links.json": "{}\n" }, "Update report");
	assert.equal(repo.run().status, 1);
});

test("builds for malformed and inaccessible previous deployment SHAs", async (t) => {
	const repo = await repository(t);
	await repo.commit({ "src/app.js": "version 1\n" }, "Initial app");
	await repo.commit({ "reports/friend-links.json": "{}\n" }, "Update report");
	for (const previous of ["--help", "HEAD^", "a".repeat(40), "abc; echo ignored"])
		assert.equal(repo.run(previous).status, 1, previous);
});

test("builds when no files have changed since the previous deployment", async (t) => {
	const repo = await repository(t);
	const deployed = await repo.commit({ "reports/friend-links.json": "{}\n" }, "Initial report");
	assert.equal(repo.run(deployed).status, 1);
});

test("builds when the previous deployment is not an ancestor of this checkout", async (t) => {
	const repo = await repository(t);
	const base = await repo.commit({ "reports/friend-links.json": "{}\n" }, "Initial report");
	repo.git("checkout", "--quiet", "-b", "other-deployment");
	const other = await repo.commit({ "reports/friend-links.json": '{"branch":"other"}\n' }, "Other report");
	repo.git("checkout", "--quiet", "master");
	await repo.commit({ "reports/friend-links.json": '{"branch":"master"}\n' }, "Master report");
	assert.notEqual(base, other);
	assert.equal(repo.run(other).status, 1);
});

test("builds when the report filename resembles the expected file but is different", async (t) => {
	const repo = await repository(t);
	const deployed = await repo.commit({ "src/app.js": "version 1\n" }, "Initial app");
	await repo.commit({ "reports/friend-links.json.bak": "{}\n" }, "Add backup");
	assert.equal(repo.run(deployed).status, 1);
});
