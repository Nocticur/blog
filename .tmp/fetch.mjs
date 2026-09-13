const clean = (s) => (s || "").replace(/^"|"$/g, "");
const url = clean(process.argv[2]);
const grep = clean(process.argv[3]);
const res = await fetch(url, { redirect: "follow" });
const text = await res.text();
console.log("STATUS", res.status, "FINAL", res.url, "LEN", text.length);
for (const [k, v] of res.headers) console.log("H", k + ":", v);
if (grep) {
	const re = new RegExp(grep, "gis");
	let m;
	let n = 0;
	while ((m = re.exec(text)) && n < 30) {
		const start = Math.max(0, m.index - 120);
		console.log("MATCH@", m.index, JSON.stringify(text.slice(start, m.index + 420)));
		n++;
		re.lastIndex = m.index + 1;
	}
	if (!n) console.log("NO MATCH", grep);
}
