// Host-side probe to the pinned bridge relay IP
const net = require("node:net");
const ip = process.argv[2] || "172.20.0.1";
const port = Number(process.argv[3] || 8642);
const s = net.connect(port, ip);
s.setTimeout(4000);
s.on("connect", () => { console.log("CONNECT_OK"); s.end(); process.exit(0); });
s.on("error", (e) => { console.log("CONNECT_ERR", e.code); process.exit(1); });
s.on("timeout", () => { console.log("CONNECT_TIMEOUT"); process.exit(2); });
