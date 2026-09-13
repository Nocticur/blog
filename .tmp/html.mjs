const url = process.argv[2];
const res = await fetch(url);
const text = await res.text();
console.log("STATUS " + res.status + " LEN " + text.length);
console.log(text);
