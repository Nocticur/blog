import fs from "node:fs";
const file = process.argv[2];
const needle = process.argv[3];
const lines = fs.readFileSync(file, "utf8").split("\n");
lines.forEach((line, i) => {
	if (!line.includes(needle)) return;
	const codes = [...line].map((ch) => {
		const cp = ch.codePointAt(0);
		return cp < 128 ? ch : `U+${cp.toString(16).toUpperCase()}`;
	});
	console.log(`L${i + 1}`, JSON.stringify(line));
	console.log(`    `, codes.join(""));
});
