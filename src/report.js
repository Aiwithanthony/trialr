/*
 * Builds a self-contained HTML analytics report for one test.
 *
 * Everything here is arithmetic and string building — no model calls. The report
 * is generated in the browser from data already in memory, so it never leaves
 * the machine, and it opens as a single file with no network dependency beyond
 * optional webfonts.
 */

// The server stores ten metrics per variant. The Tests screen only ever shows
// three of them, so the report is the one place the full set is visible.
export const REPORT_METRICS = [
  ["views", "Views", "count"],
  ["reach", "Reach", "count"],
  ["impressions", "Impressions", "count"],
  ["likes", "Likes", "count"],
  ["comments", "Comments", "count"],
  ["shares", "Shares", "count"],
  ["saves", "Saves", "count"],
  ["engagementRate", "Engagement rate", "percent"],
  ["igReelsAvgWatchTime", "Avg watch time", "duration"],
  ["igReelsVideoViewTotalTime", "Total watch time", "duration"],
];

// Categorical slots in fixed order, from the validated reference palette.
// Order is the colour-blind-safety mechanism, so never sort or cycle it.
const SERIES_COLORS = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];
const MAX_SERIES = SERIES_COLORS.length;

export function formatReportMetric(metric, value) {
  const number = Number(value || 0);
  const kind = REPORT_METRICS.find(([key]) => key === metric)?.[2] || "count";
  if (kind === "percent") return `${number.toFixed(1)}%`;
  if (kind === "duration") {
    if (number >= 60_000) {
      const minutes = Math.floor(number / 60_000);
      const seconds = Math.round((number % 60_000) / 1000);
      return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    }
    return `${(number / 1000).toFixed(1)}s`;
  }
  return number.toLocaleString("en-US");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function hoursBetween(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3_600_000;
}

/*
 * Reads the test and returns the verdict plus every reason to distrust it.
 *
 * The app picks a leader by raw maximum with no notion of whether the gap is
 * meaningful. A report looks far more authoritative than a screen does, so it
 * has to carry its own caveats or it will be over-read.
 */
export function analyseExperiment(experiment) {
  const primaryMetric = experiment?.primaryMetric || "views";
  const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
  const measured = variants
    .filter((variant) => variant.analytics)
    .sort((a, b) => Number(b.analytics[primaryMetric] || 0) - Number(a.analytics[primaryMetric] || 0));

  const leader = measured[0] || null;
  const runnerUp = measured[1] || null;
  const leaderValue = Number(leader?.analytics?.[primaryMetric] || 0);
  const runnerUpValue = Number(runnerUp?.analytics?.[primaryMetric] || 0);
  const liftPct = runnerUp && runnerUpValue > 0
    ? ((leaderValue - runnerUpValue) / runnerUpValue) * 100
    : null;

  const caveats = [];

  if (!measured.length) {
    caveats.push("No variant has analytics yet. Refresh the test once the Reels have collected data.");
  } else if (measured.length === 1) {
    caveats.push("Only one variant has analytics, so there is nothing to compare it against.");
  }

  if (liftPct !== null && liftPct < 10) {
    caveats.push(
      `The top two variants differ by ${liftPct.toFixed(1)}% on ${metricName(primaryMetric)}. ` +
      "A gap this small is within the range normal Instagram delivery variance can produce on its own, " +
      "so treat the ranking as unresolved rather than as a winner.",
    );
  }

  const reaches = measured.map((variant) => Number(variant.analytics.reach || 0)).filter((value) => value > 0);
  if (reaches.length > 1) {
    const maxReach = Math.max(...reaches);
    const minReach = Math.min(...reaches);
    if (minReach > 0 && maxReach / minReach > 1.25) {
      caveats.push(
        `Variants reached audiences of very different sizes (${minReach.toLocaleString("en-US")} to ` +
        `${maxReach.toLocaleString("en-US")}). Totals scale with exposure, so compare rates such as ` +
        "engagement rate or average watch time rather than raw counts.",
      );
    }
  }

  const publishTimes = measured.map((variant) => variant.publishedAt).filter(Boolean);
  if (publishTimes.length > 1) {
    const spread = Math.max(...publishTimes.map((time) => new Date(time).getTime()))
      - Math.min(...publishTimes.map((time) => new Date(time).getTime()));
    const spreadHours = spread / 3_600_000;
    if (spreadHours > 24) {
      caveats.push(
        `These variants were published ${Math.round(spreadHours / 24)} day(s) apart. Day of week and time of ` +
        "day both affect Reels delivery, so some of the difference may be scheduling rather than content.",
      );
    }
  }

  const ages = measured.map((variant) => variant.publishedAt).filter(Boolean);
  if (ages.length > 1) {
    const newest = Math.max(...ages.map((time) => new Date(time).getTime()));
    const oldest = Math.min(...ages.map((time) => new Date(time).getTime()));
    if (hoursBetween(newest, oldest) > 12) {
      caveats.push(
        "The variants have been live for different lengths of time. Older Reels have had longer to accumulate " +
        "views, which flatters them in any total-based comparison.",
      );
    }
  }

  const unmeasured = variants.length - measured.length;
  if (unmeasured > 0) {
    caveats.push(`${unmeasured} variant(s) have no analytics yet and are excluded from the comparison.`);
  }

  return { primaryMetric, variants, measured, leader, runnerUp, liftPct, caveats };
}

function metricName(metric) {
  return REPORT_METRICS.find(([key]) => key === metric)?.[1] || "Views";
}

/* Snapshots are captured on every refresh and are otherwise invisible in the app. */
function buildSeries(measured, primaryMetric) {
  const series = measured
    .map((variant, index) => ({
      label: variant.label,
      color: SERIES_COLORS[index % MAX_SERIES],
      points: (variant.analyticsSnapshots || [])
        .filter((snapshot) => snapshot?.capturedAt)
        .map((snapshot) => ({
          time: new Date(snapshot.capturedAt).getTime(),
          value: Number(snapshot.analytics?.[primaryMetric] || 0),
        }))
        .filter((point) => Number.isFinite(point.time))
        .sort((a, b) => a.time - b.time),
    }))
    .filter((entry) => entry.points.length > 0);

  return { series: series.slice(0, MAX_SERIES), dropped: Math.max(0, series.length - MAX_SERIES) };
}

function renderChart(measured, primaryMetric) {
  const { series, dropped } = buildSeries(measured, primaryMetric);
  const totalPoints = series.reduce((sum, entry) => sum + entry.points.length, 0);
  if (!series.length || totalPoints < 2) {
    return `<p class="muted">No refresh history yet. Each time you refresh this test, Trialr saves a snapshot; once there are at least two, this section charts how the variants moved.</p>`;
  }

  // Four or fewer series get direct labels, which need a gutter of their own —
  // laying them over the plot collides with the lines and clips the top one.
  const willLabel = series.length <= 4;
  const W = 820;
  const H = 280;
  const padL = 64;
  const padR = willLabel ? 128 : 20;
  const padT = 16;
  const padB = 40;

  const times = series.flatMap((entry) => entry.points.map((point) => point.time));
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxValue = Math.max(...values, 1);
  const spanTime = maxTime - minTime || 1;

  const x = (time) => padL + ((time - minTime) / spanTime) * (W - padL - padR);
  const y = (value) => H - padB - (value / maxValue) * (H - padT - padB);

  const ticks = [0, 0.5, 1].map((fraction) => {
    const value = maxValue * fraction;
    return `<g><line x1="${padL}" y1="${y(value).toFixed(1)}" x2="${W - padR}" y2="${y(value).toFixed(1)}" class="grid"/>` +
      `<text x="${padL - 10}" y="${(y(value) + 4).toFixed(1)}" class="axis" text-anchor="end">${escapeHtml(formatReportMetric(primaryMetric, value))}</text></g>`;
  }).join("");

  const paths = series.map((entry) => {
    const d = entry.points
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`)
      .join(" ");
    const dots = entry.points
      .map((point) => `<circle cx="${x(point.time).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="4" fill="${entry.color}" stroke="var(--surface)" stroke-width="2"/>`)
      .join("");
    return `<path d="${d}" fill="none" stroke="${entry.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join("");

  // Direct labels sit in the right gutter, nudged apart so two close-finishing
  // series stay legible, then shifted as a block if the stack runs past the axis.
  let directLabels = "";
  if (willLabel) {
    const minY = padT + 10;
    const maxY = H - padB - 2;
    const gap = 15;
    const placed = series
      .map((entry) => {
        const last = entry.points[entry.points.length - 1];
        return { entry, anchorX: x(last.time), y: Math.min(maxY, Math.max(minY, y(last.value) + 4)) };
      })
      .sort((a, b) => a.y - b.y);

    for (let index = 1; index < placed.length; index += 1) {
      if (placed[index].y - placed[index - 1].y < gap) placed[index].y = placed[index - 1].y + gap;
    }
    const overflow = placed.length ? placed[placed.length - 1].y - maxY : 0;
    if (overflow > 0) placed.forEach((item) => { item.y -= overflow; });

    directLabels = placed.map((item) =>
      `<line x1="${(item.anchorX + 4).toFixed(1)}" y1="${item.y - 4}" x2="${(W - padR + 4).toFixed(1)}" y2="${item.y - 4}" stroke="${item.entry.color}" stroke-width="1" opacity="0.35"/>` +
      `<text x="${(W - padR + 9).toFixed(1)}" y="${item.y}" class="series-label" text-anchor="start" fill="${item.entry.color}">${escapeHtml(item.entry.label)}</text>`,
    ).join("");
  }

  const legend = series.map((entry) =>
    `<li><span class="swatch" style="background:${entry.color}"></span>${escapeHtml(entry.label)}</li>`).join("");

  const droppedNote = dropped > 0
    ? `<p class="muted">${dropped} further variant(s) are not plotted — the chart carries ${MAX_SERIES} series at most. Every variant still appears in the table below.</p>`
    : "";

  return `
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(metricName(primaryMetric))} over time for each variant">
        ${ticks}
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" class="axis-line"/>
        ${paths}
        ${directLabels}
        <text x="${padL}" y="${H - 14}" class="axis">${escapeHtml(formatDate(minTime))}</text>
        <text x="${W - padR}" y="${H - 14}" class="axis" text-anchor="end">${escapeHtml(formatDate(maxTime))}</text>
      </svg>
      <ul class="legend">${legend}</ul>
      <figcaption class="muted">${escapeHtml(metricName(primaryMetric))} recorded at each refresh.</figcaption>
    </figure>
    ${droppedNote}`;
}

function renderVariantCard(variant, index, primaryMetric, isLeader) {
  const thumbnail = String(variant.thumbnail || "");
  // Only data URIs survive being saved to disk; a server path would 404.
  const media = thumbnail.startsWith("data:image/")
    ? `<img src="${escapeHtml(thumbnail)}" alt="" />`
    : `<span class="frame-empty">${index + 1}</span>`;
  const url = String(variant.platformPostUrl || "");
  const link = /^https:\/\//.test(url)
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open on Instagram</a>`
    : `<span class="muted">No Instagram link yet</span>`;

  return `
    <article class="variant${isLeader ? " variant-leader" : ""}">
      <div class="frame">${media}</div>
      <div class="variant-body">
        <h3>${escapeHtml(variant.label)}${isLeader ? ' <span class="tag">Leading</span>' : ""}</h3>
        <p class="muted">Published ${escapeHtml(formatDate(variant.publishedAt))}${variant.originalFilename ? ` · ${escapeHtml(variant.originalFilename)}` : ""}</p>
        <p class="headline">${escapeHtml(variant.analytics ? formatReportMetric(primaryMetric, variant.analytics[primaryMetric]) : "Pending")}<span class="muted"> ${escapeHtml(metricName(primaryMetric))}</span></p>
        <p>${link}</p>
      </div>
    </article>`;
}

export function buildReportHtml(experiment, { generatedAt = new Date() } = {}) {
  const analysis = analyseExperiment(experiment);
  const { primaryMetric, measured, leader, runnerUp, liftPct, caveats } = analysis;
  const name = experiment?.name || "Untitled test";

  const verdict = !leader
    ? `<p class="verdict-none">No results yet.</p>`
    : `<p class="verdict-name">${escapeHtml(leader.label)}</p>
       <p class="verdict-detail">Leads on ${escapeHtml(metricName(primaryMetric))} with
       ${escapeHtml(formatReportMetric(primaryMetric, leader.analytics[primaryMetric]))}${
      runnerUp && liftPct !== null
        ? `, ${liftPct >= 0 ? "+" : ""}${liftPct.toFixed(1)}% against ${escapeHtml(runnerUp.label)}`
        : ""
    }.</p>`;

  const header = REPORT_METRICS
    .map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("");
  const rows = measured.map((variant) => {
    const cells = REPORT_METRICS
      .map(([metric]) => `<td${metric === primaryMetric ? ' class="is-primary"' : ""}>${escapeHtml(formatReportMetric(metric, variant.analytics[metric]))}</td>`)
      .join("");
    return `<tr><th scope="row">${escapeHtml(variant.label)}</th>${cells}</tr>`;
  }).join("");

  const table = measured.length
    ? `<div class="table-scroll"><table>
         <thead><tr><th scope="col">Variant</th>${header}</tr></thead>
         <tbody>${rows}</tbody>
       </table></div>`
    : `<p class="muted">No analytics recorded yet.</p>`;

  const caveatList = caveats.length
    ? `<section>
         <h2>Read this before drawing conclusions</h2>
         <ul class="caveats">${caveats.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
       </section>`
    : `<section>
         <h2>Read this before drawing conclusions</h2>
         <p>Nothing in the data undermines the comparison above. Instagram analytics still lag behind publishing, so refresh again later to confirm the result holds.</p>
       </section>`;

  const variantCards = measured.length
    ? measured.map((variant, index) => renderVariantCard(variant, index, primaryMetric, leader?.id === variant.id)).join("")
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(name)} — Trialr report</title>
<style>
  :root {
    --ground: #f7f5f0;
    --surface: #fdfcfa;
    --edge: #ddd8ce;
    --ink: #24211c;
    --ink-dim: #5d574d;
    --ink-faint: #857e72;
    --signal: #1f6b3c;
    --alert: #8a2417;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 24px 72px;
    background: var(--ground);
    color: var(--ink);
    font-family: "Archivo", ui-sans-serif, system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 880px; margin: 0 auto; }
  h1, h2, h3 {
    font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }
  h1 { font-size: 34px; margin: 0 0 6px; }
  h2 { font-size: 18px; margin: 40px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--edge); }
  h3 { font-size: 16px; margin: 0 0 2px; }
  p { margin: 0 0 10px; }
  .muted { color: var(--ink-faint); font-size: 13px; }
  .eyebrow {
    font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: 8px;
  }
  .hypothesis { max-width: 62ch; color: var(--ink-dim); }
  .verdict { margin: 28px 0 0; padding: 20px 22px; border: 1px solid var(--edge); background: var(--surface); }
  .verdict-name {
    font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
    font-size: 26px; font-weight: 600; letter-spacing: -0.03em; margin: 0 0 4px; color: var(--signal);
  }
  .verdict-detail { margin: 0; color: var(--ink-dim); }
  .verdict-none { margin: 0; color: var(--ink-faint); }
  .caveats { margin: 0; padding-left: 20px; color: var(--ink-dim); }
  .caveats li { margin-bottom: 8px; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 9px 12px; text-align: right; border-bottom: 1px solid var(--edge); white-space: nowrap; }
  thead th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; }
  tbody th { text-align: left; font-weight: 600; }
  td.is-primary { color: var(--signal); font-weight: 600; }
  .chart { margin: 0; }
  .chart svg { width: 100%; height: auto; background: var(--surface); border: 1px solid var(--edge); }
  .grid { stroke: var(--edge); stroke-width: 1; }
  .axis-line { stroke: var(--ink-faint); stroke-width: 1; }
  .axis { fill: var(--ink-faint); font-size: 11px; font-family: "Archivo", sans-serif; }
  .series-label { font-size: 12px; font-weight: 600; font-family: "Archivo", sans-serif; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; list-style: none; margin: 12px 0 6px; padding: 0; font-size: 13px; }
  .legend li { display: flex; align-items: center; gap: 6px; }
  .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  .variants { display: grid; gap: 14px; }
  .variant { display: flex; gap: 16px; padding: 14px; border: 1px solid var(--edge); background: var(--surface); }
  .variant-leader { border-color: var(--signal); }
  .frame { flex: 0 0 auto; width: 62px; height: 110px; border: 1px solid var(--edge); background: var(--ground); overflow: hidden; }
  .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .frame-empty { display: grid; place-items: center; width: 100%; height: 100%; color: var(--ink-faint); font-size: 20px; }
  .variant-body { min-width: 0; }
  .headline { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 6px 0 4px; }
  .headline .muted { font-size: 13px; font-weight: 400; }
  .tag {
    display: inline-block; margin-left: 6px; padding: 2px 7px; border: 1px solid var(--signal);
    font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--signal); vertical-align: middle;
  }
  a { color: var(--signal); }
  footer { margin-top: 44px; padding-top: 14px; border-top: 1px solid var(--edge); color: var(--ink-faint); font-size: 12px; }
  @media print {
    body { padding: 0; background: #fff; }
    .variant, .verdict, .chart svg { break-inside: avoid; }
  }
</style>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,600&display=swap" rel="stylesheet" />
</head>
<body>
<main>
  <p class="eyebrow">Trialr report</p>
  <h1>${escapeHtml(name)}</h1>
  <p class="hypothesis">${escapeHtml(experiment?.hypothesis || "No hypothesis recorded.")}</p>

  <div class="verdict">
    <p class="eyebrow">Leading on ${escapeHtml(metricName(primaryMetric))}</p>
    ${verdict}
  </div>

  ${caveatList}

  <h2>All metrics</h2>
  ${table}

  <h2>Over time</h2>
  ${renderChart(measured, primaryMetric)}

  <h2>Variants</h2>
  <div class="variants">${variantCards || '<p class="muted">Nothing published into this test yet.</p>'}</div>

  <footer>
    Generated ${escapeHtml(formatDate(generatedAt))} from locally stored data.
    Instagram analytics can lag behind publishing, and some metrics return zero depending on the post.
  </footer>
</main>
</body>
</html>`;
}

export function reportFilename(experiment, generatedAt = new Date()) {
  const slug = String(experiment?.name || "trialr-test")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "trialr-test";
  const stamp = new Date(generatedAt).toISOString().slice(0, 10);
  return `${slug}-${stamp}.html`;
}

export function downloadExperimentReport(experiment, generatedAt = new Date()) {
  const html = buildReportHtml(experiment, { generatedAt });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = reportFilename(experiment, generatedAt);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
