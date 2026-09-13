const targets = process.argv.slice(2);
for (const url of targets) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    console.log("=== " + url + " -> " + res.status + " " + res.url);
    for (const [k, v] of res.headers.entries()) {
      console.log("  " + k + ": " + v);
    }
  } catch (e) {
    console.log("=== " + url + " ERROR " + e.message);
  }
}
