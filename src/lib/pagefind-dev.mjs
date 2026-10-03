import fs from "node:fs/promises";
import path from "node:path";

// Pagefind is generated after the build. Make that real index available in dev.
export function pagefindDev(root = process.cwd()) {
	const directory = path.resolve(root, "dist/pagefind");
	return {
		name: "firefly-pagefind-dev",
		configureServer(server) {
			server.middlewares.use("/pagefind", async (req, res, next) => {
				if (!["GET", "HEAD"].includes(req.method)) {
					res.statusCode = 405;
					res.end();
					return;
				}
				try {
					const requested = decodeURIComponent(
						new URL(req.url, "http://localhost").pathname,
					);
					const file = path.resolve(directory, `.${requested}`);
					if (!file.startsWith(`${directory}${path.sep}`)) return next();
					const body = await fs.readFile(file);
					const types = {
						".js": "text/javascript; charset=utf-8",
						".json": "application/json; charset=utf-8",
						".wasm": "application/wasm",
						".css": "text/css; charset=utf-8",
					};
					res.setHeader(
						"Content-Type",
						types[path.extname(file)] || "application/octet-stream",
					);
					res.setHeader("Cache-Control", "no-store");
					res.end(req.method === "HEAD" ? undefined : body);
				} catch {
					next();
				}
			});
		},
	};
}
