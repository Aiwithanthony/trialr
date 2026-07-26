import assert from "node:assert/strict";
import test from "node:test";
import { analyseExperiment, buildReportHtml, escapeHtml, formatReportMetric, reportFilename } from "../src/report.js";

function variant(label, analytics, extra = {}) {
  return {
    id: label,
    label,
    analytics,
    publishedAt: "2026-02-01T10:00:00.000Z",
    analyticsSnapshots: [],
    ...extra,
  };
}

test("ranks variants by the test's primary metric, not by views", () => {
  const experiment = {
    name: "Hook test",
    primaryMetric: "saves",
    variants: [
      variant("A", { views: 90_000, saves: 10, reach: 50_000 }),
      variant("B", { views: 1_000, saves: 900, reach: 50_000 }),
    ],
  };

  const { leader, runnerUp } = analyseExperiment(experiment);
  assert.equal(leader.label, "B");
  assert.equal(runnerUp.label, "A");
});

test("a small gap is reported as unresolved rather than a win", () => {
  const experiment = {
    primaryMetric: "views",
    variants: [
      variant("A", { views: 10_400, reach: 10_000 }),
      variant("B", { views: 10_000, reach: 10_000 }),
    ],
  };

  const { liftPct, caveats } = analyseExperiment(experiment);
  assert.ok(liftPct < 10);
  assert.ok(caveats.some((text) => text.includes("unresolved")));
});

test("a decisive gap carries no small-difference caveat", () => {
  const experiment = {
    primaryMetric: "views",
    variants: [
      variant("A", { views: 30_000, reach: 10_000 }),
      variant("B", { views: 10_000, reach: 10_000 }),
    ],
  };

  const { liftPct, caveats } = analyseExperiment(experiment);
  assert.equal(Math.round(liftPct), 200);
  assert.ok(!caveats.some((text) => text.includes("unresolved")));
});

test("wildly different reach is flagged, because totals scale with exposure", () => {
  const experiment = {
    primaryMetric: "views",
    variants: [
      variant("A", { views: 30_000, reach: 40_000 }),
      variant("B", { views: 10_000, reach: 4_000 }),
    ],
  };

  const { caveats } = analyseExperiment(experiment);
  assert.ok(caveats.some((text) => text.includes("different sizes")));
});

test("variants published days apart are flagged as a scheduling confound", () => {
  const experiment = {
    primaryMetric: "views",
    variants: [
      variant("A", { views: 30_000, reach: 10_000 }, { publishedAt: "2026-02-01T10:00:00.000Z" }),
      variant("B", { views: 10_000, reach: 10_000 }, { publishedAt: "2026-02-05T10:00:00.000Z" }),
    ],
  };

  const { caveats } = analyseExperiment(experiment);
  assert.ok(caveats.some((text) => text.includes("apart")));
});

test("a single measured variant reports that there is nothing to compare", () => {
  const experiment = {
    primaryMetric: "views",
    variants: [variant("A", { views: 30_000, reach: 10_000 }), { id: "B", label: "B", analytics: null }],
  };

  const { caveats, liftPct } = analyseExperiment(experiment);
  assert.equal(liftPct, null);
  assert.ok(caveats.some((text) => text.includes("nothing to compare")));
  assert.ok(caveats.some((text) => text.includes("no analytics yet")));
});

test("durations and rates are formatted for humans", () => {
  assert.equal(formatReportMetric("views", 18420), "18,420");
  assert.equal(formatReportMetric("igReelsAvgWatchTime", 7800), "7.8s");
  assert.equal(formatReportMetric("igReelsVideoViewTotalTime", 605_000), "10m 05s");
  assert.equal(formatReportMetric("engagementRate", 4.25), "4.3%");
});

test("names that look like markup cannot break out of the report", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");

  const html = buildReportHtml({
    name: '<img src=x onerror="alert(1)">',
    primaryMetric: "views",
    variants: [variant('</td><script>bad()</script>', { views: 10, reach: 10 })],
  });

  assert.ok(!html.includes("<script>bad()</script>"));
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
});

test("only embeddable thumbnails and https links reach the report", () => {
  const html = buildReportHtml({
    name: "Media test",
    primaryMetric: "views",
    variants: [
      variant("Server path", { views: 10, reach: 10 }, { thumbnail: "/demo/sunset.jpg", platformPostUrl: "javascript:alert(1)" }),
      variant("Embedded", { views: 20, reach: 10 }, { thumbnail: "data:image/jpeg;base64,AAAA", platformPostUrl: "https://instagram.com/reel/abc" }),
    ],
  });

  // A server path would 404 once the file is saved elsewhere.
  assert.ok(!html.includes("/demo/sunset.jpg"));
  assert.ok(html.includes("data:image/jpeg;base64,AAAA"));
  assert.ok(!html.includes("javascript:alert(1)"));
  assert.ok(html.includes("https://instagram.com/reel/abc"));
});

test("the report always ships the full metric table the chart's palette relies on", () => {
  const html = buildReportHtml({
    name: "Full test",
    primaryMetric: "views",
    variants: [variant("A", { views: 10, reach: 10, impressions: 12, likes: 3, comments: 1, shares: 2, saves: 4, engagementRate: 2.5, igReelsAvgWatchTime: 4200, igReelsVideoViewTotalTime: 90000 })],
  });

  for (const label of ["Views", "Reach", "Impressions", "Likes", "Comments", "Shares", "Saves", "Engagement rate", "Avg watch time", "Total watch time"]) {
    assert.ok(html.includes(label), `report is missing the ${label} column`);
  }
  assert.ok(html.includes("<table>"));
});

test("filenames are slugged and dated", () => {
  assert.equal(reportFilename({ name: "Opening text colour!" }, "2026-02-09T10:00:00.000Z"), "opening-text-colour-2026-02-09.html");
  assert.equal(reportFilename({ name: "" }, "2026-02-09T10:00:00.000Z"), "trialr-test-2026-02-09.html");
});
