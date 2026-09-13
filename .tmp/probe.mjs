const base = "https://mail.mourn.top";
const paths = [
  "/assets/init-loader.js",
  "/assets/env.js",
  "/assets/theme-init.js",
  "/assets/manifest-loader.js",
  "/assets/sw-register.js",
];
for (const p of paths) {
  try {
    const res = await fetch(base + p);
    const text = await res.text();
    console.log("### " + p + " -> " + res.status + " len=" + text.length);
    console.log(text.slice(0, 300).replace(/\n/g, "\n    "));
  } catch (e) {
    console.log("### " + p + " ERROR " + e.message);
  }
}
