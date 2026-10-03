import { createRequire } from "node:module";
import { getIconData, iconToSVG, replaceIDs } from "@iconify/utils";

const require = createRequire(import.meta.url);
const packages = new Map([
	["material-symbols", "@iconify-json/material-symbols"],
	["fa7-solid", "@iconify-json/fa7-solid"],
	["fa7-brands", "@iconify-json/fa7-brands"],
	["fa7-regular", "@iconify-json/fa7-regular"],
	["mdi", "@iconify-json/mdi"],
	["mingcute", "@iconify-json/mingcute"],
	["ri", "@iconify-json/ri"],
	["simple-icons", "@iconify-json/simple-icons"],
	["svg-spinners", "@iconify-json/svg-spinners"],
]);
const sets = new Map();

// Only installed, allowlisted icon data is read; no SVG downloads or ZIP extraction.
export function renderLocalIcon(name) {
	const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(name);
	const packageName = match && packages.get(match[1]);
	if (!packageName) throw new Error(`无效或未安装的图标集: ${name}`);
	if (!sets.has(packageName))
		sets.set(packageName, require(`${packageName}/icons.json`));
	const data = getIconData(sets.get(packageName), match[2]);
	if (!data) throw new Error(`图标未找到: ${name}`);
	const icon = iconToSVG(data, { width: "1em", height: "1em" });
	return { attributes: icon.attributes, body: replaceIDs(icon.body) };
}
