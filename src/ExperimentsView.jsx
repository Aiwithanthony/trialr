import { useState } from "react";
import {
  IconArrowLeft,
  IconAlertCircle,
  IconAlertTriangle,
  IconBrandInstagram,
  IconCircleCheck,
  IconExternalLink,
  IconFlask,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { ThemeToggle } from "./ThemeToggle.jsx";

export const METRIC_OPTIONS = [
  ["views", "Views"],
  ["reach", "Reach"],
  ["igReelsAvgWatchTime", "Average watch time"],
  ["saves", "Saves"],
  ["shares", "Shares"],
];

export function metricLabel(metric) {
  return METRIC_OPTIONS.find(([value]) => value === metric)?.[1] || "Views";
}

// Column headings have less room than the primary readout above them.
const SHORT_METRIC_LABELS = {
  views: "Views",
  reach: "Reach",
  igReelsAvgWatchTime: "Avg watch",
  saves: "Saves",
  shares: "Shares",
};

// Whichever metric the test optimises for is already shown large, so the
// supporting columns skip it rather than printing the same figure twice.
function supportingMetrics(primaryMetric) {
  return ["views", "reach", "igReelsAvgWatchTime", "saves", "shares"]
    .filter((metric) => metric !== primaryMetric)
    .slice(0, 3);
}

function formatMetric(metric, value) {
  const number = Number(value || 0);
  if (metric === "igReelsAvgWatchTime") return `${(number / 1000).toFixed(1)}s`;
  if (metric === "engagementRate") return `${number.toFixed(1)}%`;
  return number.toLocaleString();
}

function formatDate(value) {
  if (!value) return "Not published yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function mostRecentRefresh(experiment) {
  return experiment.variants.reduce((latest, variant) => {
    if (!variant.lastRefreshedAt) return latest;
    return !latest || variant.lastRefreshedAt > latest ? variant.lastRefreshedAt : latest;
  }, "");
}

function VariantMedia({ variant, linked }) {
  return (
    <span className="variant-media" aria-hidden="true">
      {variant.thumbnail ? (
        <img src={variant.thumbnail} alt="" />
      ) : variant.mediaUrl ? (
        <video src={`${variant.mediaUrl}#t=0.1`} muted playsInline preload="metadata" />
      ) : (
        <span className="variant-media-fallback"><IconBrandInstagram size={20} stroke={1.6} /></span>
      )}
      {linked && <span className="variant-media-open"><IconExternalLink size={16} /></span>}
    </span>
  );
}

function VariantIdentity({ variant }) {
  const identity = (
    <>
      <VariantMedia variant={variant} linked={Boolean(variant.platformPostUrl)} />
      <div>
        <strong>{variant.label}</strong>
        <span>{formatDate(variant.publishedAt)}{variant.originalFilename ? ` · ${variant.originalFilename}` : ""}</span>
      </div>
    </>
  );

  if (variant.platformPostUrl) {
    return (
      <a className="variant-identity variant-identity-link" href={variant.platformPostUrl} target="_blank" rel="noreferrer" aria-label={`Open ${variant.label} on Instagram`} title="Open on Instagram">
        {identity}
      </a>
    );
  }

  return <div className="variant-identity" title="Instagram link appears after publishing data is available">{identity}</div>;
}

export function ExperimentsView({
  experiments,
  selectedExperimentId,
  onSelectExperiment,
  onBack,
  onNewExperiment,
  onRefreshExperiment,
  refreshingExperimentId,
  onDeleteExperiment,
  deletingExperimentId,
  notice,
  onDismissNotice,
  themePreference = "system",
  onThemePreferenceChange,
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const selected = experiments.find((experiment) => experiment.id === selectedExperimentId) || experiments[0] || null;
  const metric = selected?.primaryMetric || "views";
  const measured = selected?.variants.filter((variant) => variant.analytics) || [];
  const leader = measured.reduce((best, variant) => {
    if (!best) return variant;
    return Number(variant.analytics?.[metric] || 0) > Number(best.analytics?.[metric] || 0) ? variant : best;
  }, null);
  const lastRefresh = selected ? mostRecentRefresh(selected) : "";
  const supporting = supportingMetrics(metric);

  return (
    <main className="experiments-page experiments-page-studio">
      <header className="experiments-topbar">
        <button className="wordmark" type="button" onClick={onBack}>
          <span className="brand-mark"><IconFlask size={16} stroke={1.7} /></span>
          <span>Trialr</span>
        </button>
        <button className="back-to-publish" type="button" onClick={onBack}><IconArrowLeft size={18} /> Publish</button>
        <div className="experiments-topbar-actions">
          <ThemeToggle value={themePreference} onChange={onThemePreferenceChange} />
          <button className="new-experiment-button" type="button" onClick={onNewExperiment}><IconPlus size={18} /> New test</button>
        </div>
      </header>

      {notice && (
        <div className={`experiments-notice notice notice-${notice.type}`} role="status">
          {notice.type === "success" ? <IconCircleCheck size={20} /> : <IconAlertCircle size={20} />}
          <span>{notice.text}</span>
          <button type="button" onClick={onDismissNotice} aria-label="Dismiss message"><IconX size={17} /></button>
        </div>
      )}

      <div className="experiments-layout">
        <aside className="experiment-list-pane" aria-label="Tests">
          <div className="experiments-title">
            <span className="experiment-title-icon"><IconFlask size={23} /></span>
            <div><h1>Tests</h1><p>Group variants across publishing sessions.</p></div>
          </div>
          <div className="experiment-list">
            {experiments.length ? experiments.map((experiment) => (
              <button
                className={`experiment-list-item ${selected?.id === experiment.id ? "experiment-list-item-active" : ""}`}
                type="button"
                key={experiment.id}
                onClick={() => onSelectExperiment(experiment.id)}
              >
                <strong>{experiment.name}</strong>
                <span>{experiment.variants.length} variant{experiment.variants.length === 1 ? "" : "s"} · {metricLabel(experiment.primaryMetric)}</span>
              </button>
            )) : (
              <div className="experiment-list-empty">Create your first test, then publish variants into it over time.</div>
            )}
          </div>
        </aside>

        <section className="experiment-detail-pane" aria-live="polite">
          {selected ? (
            <>
              <div className="experiment-detail-header">
                <div>
                  <span className="eyebrow">Active experiment</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.hypothesis || "No hypothesis added yet."}</p>
                </div>
                <div className="experiment-detail-actions">
                  <button type="button" onClick={() => onRefreshExperiment(selected.id)} disabled={!selected.variants.length || refreshingExperimentId === selected.id}>
                    {refreshingExperimentId === selected.id ? <IconLoader2 className="spin" size={19} /> : <IconRefresh size={19} />}
                    Refresh stats
                  </button>
                  <button
                    className="delete-experiment-button"
                    type="button"
                    onClick={() => setConfirmDeleteId(selected.id)}
                    disabled={confirmDeleteId === selected.id || deletingExperimentId === selected.id}
                    aria-label={`Delete ${selected.name}`}
                    title="Delete this test"
                  >
                    <IconTrash size={19} />
                  </button>
                </div>
              </div>

              {confirmDeleteId === selected.id && (
                <div className="delete-confirm" role="alertdialog" aria-label={`Confirm deleting ${selected.name}`}>
                  <IconAlertTriangle size={21} />
                  <div className="delete-confirm-copy">
                    <strong>Delete “{selected.name}”?</strong>
                    <span>
                      {selected.variants.length
                        ? `This permanently removes the saved history for ${selected.variants.length} published variant${selected.variants.length === 1 ? "" : "s"}. The Reels stay live on Instagram, but their tracked stats cannot be recovered.`
                        : "This test has no variants, so nothing published is affected."}
                    </span>
                  </div>
                  <div className="delete-confirm-actions">
                    <button type="button" onClick={() => setConfirmDeleteId("")} disabled={deletingExperimentId === selected.id}>Cancel</button>
                    <button
                      type="button"
                      className="delete-confirm-go"
                      onClick={() => {
                        setConfirmDeleteId("");
                        onDeleteExperiment(selected.id);
                      }}
                      disabled={deletingExperimentId === selected.id}
                    >
                      {deletingExperimentId === selected.id ? <IconLoader2 className="spin" size={17} /> : <IconTrash size={17} />}
                      Delete test
                    </button>
                  </div>
                </div>
              )}

              <div className="experiment-summary-grid">
                <div><span>Primary metric</span><strong>{metricLabel(metric)}</strong></div>
                <div><span>Variants</span><strong>{selected.variants.length}</strong></div>
                <div><span>Current leader</span><strong>{leader?.label || "Waiting for data"}</strong></div>
                <div><span>Stats updated</span><strong>{lastRefresh ? formatDate(lastRefresh) : "Not yet"}</strong></div>
              </div>

              <div className="variant-results-heading">
                <div><h3>Variants</h3><p>Compare each Reel after the same amount of time whenever possible.</p></div>
              </div>

              <div className="variant-results">
                {selected.variants.length ? selected.variants.map((variant) => (
                  <article className={`variant-result ${leader?.id === variant.id && measured.length > 1 ? "variant-result-leading" : ""}`} key={variant.id}>
                    <VariantIdentity variant={variant} />
                    <div className="variant-primary-metric">
                      <span>{metricLabel(metric)}</span>
                      <strong>{variant.analytics ? formatMetric(metric, variant.analytics[metric]) : "Pending"}</strong>
                    </div>
                    <div className="variant-secondary-metrics">
                      {supporting.map((entry) => (
                        <span key={entry}>
                          {SHORT_METRIC_LABELS[entry]} <strong>{variant.analytics ? formatMetric(entry, variant.analytics[entry]) : "--"}</strong>
                        </span>
                      ))}
                    </div>
                    <div className="variant-result-action">
                      {leader?.id === variant.id && measured.length > 1 && <span className="leader-badge">Leading</span>}
                    </div>
                  </article>
                )) : (
                  <div className="variant-empty-state">
                    <IconFlask size={32} stroke={1.5} />
                    <strong>No variants yet</strong>
                    <span>Select this test in Publish, then submit your first Trial Reels.</span>
                    <button type="button" onClick={onBack}>Go to Publish</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="experiment-detail-empty">
              <IconFlask size={42} stroke={1.4} />
              <h2>Start your first test</h2>
              <p>Name the variable you are testing, choose the metric that matters, and publish variants into it across multiple sessions.</p>
              <button type="button" onClick={onNewExperiment}><IconPlus size={18} /> Create a test</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
