// Renders a 31-day contribution activity graph as an SVG.
// Usage: GITHUB_TOKEN=... node activity-graph.mjs <username> <output.svg>
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , username, outPath = "profile/activity-graph.svg"] = process.argv;
const token = process.env.GITHUB_TOKEN;
if (!username || !token) {
  console.error("Usage: GITHUB_TOKEN=... node activity-graph.mjs <username> [out.svg]");
  process.exit(1);
}

const DAYS = 31;
const to = new Date();
const from = new Date(to.getTime() - (DAYS - 1) * 864e5);

const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
  user(login:$login){ contributionsCollection(from:$from,to:$to){
    contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { login: username, from: from.toISOString(), to: to.toISOString() } }),
});
const json = await res.json();
if (!res.ok || json.errors) {
  console.error("GraphQL error:", JSON.stringify(json.errors ?? json));
  process.exit(1);
}

const days = json.data.user.contributionsCollection.contributionCalendar.weeks
  .flatMap((w) => w.contributionDays)
  .slice(-DAYS);

// Layout
const W = 1000, H = 320, padL = 56, padR = 24, padT = 56, padB = 44;
const innerW = W - padL - padR, innerH = H - padT - padB;
const max = Math.max(4, ...days.map((d) => d.contributionCount));
const step = innerW / (days.length - 1);
const x = (i) => padL + i * step;
const y = (v) => padT + innerH - (v / max) * innerH;

const pts = days.map((d, i) => [x(i), y(d.contributionCount)]);
// Smooth path (Catmull-Rom → cubic Bézier)
let line = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
for (let i = 0; i < pts.length - 1; i++) {
  const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
  const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(padT + innerH, p1[1] + (p2[1] - p0[1]) / 6)];
  const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(padT + innerH, p2[1] - (p3[1] - p1[1]) / 6)];
  line += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
}
const area = `${line} L${x(days.length - 1).toFixed(1)},${padT + innerH} L${padL},${padT + innerH} Z`;

const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
const grid = [...new Set(ticks)]
  .map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>` +
    `<text x="${padL - 10}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`)
  .join("");
const labels = days
  .map((d, i) => (i % 3 === 0 || i === days.length - 1)
    ? `<text x="${x(i)}" y="${H - padB + 22}" text-anchor="middle" class="axis">${Number(d.date.slice(8))}</text>` : "")
  .join("");
const dots = pts
  .map(([px, py], i) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" class="dot"><title>${days[i].date}: ${days[i].contributionCount} contributions</title></circle>`)
  .join("");
const total = days.reduce((s, d) => s + d.contributionCount, 0);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${username}'s contributions in the last ${DAYS} days">
<style>
  .bg{fill:#0D1117}.title{fill:#58A6FF;font:600 18px 'Segoe UI',Ubuntu,sans-serif}
  .sub{fill:#8B949E;font:400 13px 'Segoe UI',Ubuntu,sans-serif}
  .axis{fill:#8B949E;font:400 11px 'Segoe UI',Ubuntu,sans-serif}
  .grid{stroke:#21262D;stroke-width:1}.line{fill:none;stroke:#58A6FF;stroke-width:2.5;stroke-linecap:round}
  .dot{fill:#C9D1D9;stroke:#0D1117;stroke-width:1.5}
</style>
<defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#58A6FF" stop-opacity=".45"/><stop offset="1" stop-color="#58A6FF" stop-opacity="0"/></linearGradient></defs>
<rect class="bg" width="${W}" height="${H}" rx="8"/>
<text x="${padL}" y="30" class="title">${username}'s Contribution Graph</text>
<text x="${W - padR}" y="30" text-anchor="end" class="sub">${total} contributions · last ${DAYS} days</text>
${grid}
<path d="${area}" fill="url(#g)"/>
<path d="${line}" class="line"/>
${dots}
${labels}
</svg>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, svg);
console.log(`Wrote ${outPath} (${total} contributions over ${DAYS} days)`);
