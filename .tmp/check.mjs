const urls = process.argv.slice(2);
for (const u of urls) {
	try {
		const res = await fetch(u, {
			headers: { Referer: "https://blog.mourn.top/", "User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36" },
		});
		const buf = await res.arrayBuffer();
		console.log(
			res.status,
			buf.byteLength,
			res.headers.get("content-type"),
			"| xfo=" + res.headers.get("x-frame-options"),
			"| cps=" + res.headers.get("cross-origin-resource-policy"),
			u,
		);
	} catch (e) {
		const c = e.cause;
		console.log("ERR", e.name, e.message, "| cause:", c && (c.code || c.message), u);
	}
}
