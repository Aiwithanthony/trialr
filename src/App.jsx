import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconBrandInstagram,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconEye,
  IconFlask,
  IconGripVertical,
  IconLoader2,
  IconPointFilled,
  IconPlus,
  IconRefresh,
  IconSchool,
  IconSend2,
  IconSettings,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { ExperimentsView, METRIC_OPTIONS, metricLabel } from "./ExperimentsView.jsx";
import { getPublishLabel, getReadyItems, normalizeDisplayName, reorderItems } from "./publishing.js";
import { ThemeToggle } from "./ThemeToggle.jsx";

const MAX_FILES = 10;
const MAX_CAPTION = 2200;
const MAX_FILE_SIZE = 300 * 1024 * 1024;
const POLL_INTERVAL = 3000;
const POLL_LIMIT = 30;
const THEME_STORAGE_KEY = "trialr-v2-theme";
const VALID_THEMES = new Set(["light", "system", "dark"]);

const demoItems = [
  ["Morning cliffs.mp4", "/demo/coastal-cliffs.jpg", 18, 72.4],
  ["Sushi market walk.mp4", "/demo/lantern-market.jpg", 24, 89.7],
  ["Sunset surf.mp4", "/demo/sunset-surf.jpg", 15, 61.3],
  ["Latte art close-up.mp4", "/demo/latte-art.jpg", 12, 48.8],
  ["Rainy night lights.mp4", "/demo/rainy-night.jpg", 20, 77.6],
  ["Alpine trail hike.mp4", "/demo/alpine-hike.jpg", 17, 69.1],
].map(([name, thumbnail, duration, sizeMb]) => ({
  id: name,
  file: null,
  name,
  thumbnail,
  duration,
  width: 1080,
  height: 1920,
  size: sizeMb * 1024 * 1024,
  errors: [],
  status: "ready",
  progress: 0,
}));

const demoExperiments = [{
  id: "demo-opening-text-color",
  name: "Opening text color",
  hypothesis: "A warmer opening text color will hold attention longer.",
  primaryMetric: "views",
  status: "active",
  createdAt: "2026-01-15T14:00:00.000Z",
  variants: [
    { id: "demo-coral", label: "Coral text hook", status: "published", publishedAt: "2026-01-15T14:05:00.000Z", originalFilename: "hook-coral.mp4", thumbnail: "/demo/sunset-surf.jpg", analytics: { views: 18420, reach: 15980, saves: 388, shares: 214, igReelsAvgWatchTime: 7800 }, lastRefreshedAt: "2026-01-18T14:05:00.000Z" },
    { id: "demo-blue", label: "Blue text hook", status: "published", publishedAt: "2026-01-15T14:12:00.000Z", originalFilename: "hook-blue.mp4", thumbnail: "/demo/lantern-market.jpg", analytics: { views: 12940, reach: 11120, saves: 241, shares: 132, igReelsAvgWatchTime: 6100 }, lastRefreshedAt: "2026-01-18T14:05:00.000Z" },
    { id: "demo-white", label: "White text hook", status: "published", publishedAt: "2026-01-15T14:20:00.000Z", originalFilename: "hook-white.mp4", thumbnail: "/demo/coastal-cliffs.jpg", analytics: { views: 15110, reach: 13480, saves: 306, shares: 176, igReelsAvgWatchTime: 6900 }, lastRefreshedAt: "2026-01-18T14:05:00.000Z" },
  ],
}];

function formatDuration(value) {
  if (!Number.isFinite(value)) return "--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, "0");
  return minutes ? `${minutes}:${seconds}` : `0:${seconds}`;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeError(error, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
  return data;
}

function inspectVideo(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    const finish = (details) => {
      video.removeAttribute("src");
      video.load();
      resolve({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        progress: 0,
        ...details,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      finish({
        thumbnail: "",
        duration: 0,
        width: 0,
        height: 0,
        errors: ["This video could not be read."],
        status: "invalid",
      });
    };

    video.onloadedmetadata = () => {
      const errors = [];
      const extension = file.name.split(".").pop()?.toLowerCase();
      const ratio = video.videoWidth / video.videoHeight;

      if (!["mp4", "mov", "m4v"].includes(extension || "")) errors.push("Use an MP4 or MOV file.");
      if (file.size > MAX_FILE_SIZE) errors.push("Video exceeds Instagram's 300 MB Reel limit.");
      if (video.duration < 3 || video.duration > 90) errors.push("Trial Reels must be between 3 and 90 seconds.");
      if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 0.63) errors.push("Use a vertical 9:16 video.");

      const captureFrame = () => {
        let thumbnail = objectUrl;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const context = canvas.getContext("2d");
          const sourceRatio = video.videoWidth / video.videoHeight;
          const targetRatio = canvas.width / canvas.height;
          let sourceWidth = video.videoWidth;
          let sourceHeight = video.videoHeight;
          let sourceX = 0;
          let sourceY = 0;

          if (sourceRatio > targetRatio) {
            sourceWidth = video.videoHeight * targetRatio;
            sourceX = (video.videoWidth - sourceWidth) / 2;
          } else {
            sourceHeight = video.videoWidth / targetRatio;
            sourceY = (video.videoHeight - sourceHeight) / 2;
          }

          context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
          thumbnail = canvas.toDataURL("image/jpeg", 0.82);
        } catch {
          thumbnail = objectUrl;
        }

        URL.revokeObjectURL(objectUrl);
        finish({
          thumbnail,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          errors,
          status: errors.length ? "invalid" : "ready",
        });
      };

      video.currentTime = Math.min(0.2, Math.max(video.duration / 3, 0));
      video.onseeked = captureFrame;
      setTimeout(captureFrame, 1200);
    };
  });
}

function uploadVideo(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Video upload failed with HTTP ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error("Video upload failed. Check your connection and retry."));
    xhr.send(file);
  });
}

function itemState(item) {
  if (item.status === "uploading") return { label: `Uploading ${item.progress}%`, tone: "progress" };
  if (item.status === "publishing") return { label: "Publishing", tone: "progress" };
  if (item.status === "processing") return { label: "Processing", tone: "progress" };
  if (item.status === "published") return { label: "Published", tone: "success" };
  if (item.status === "failed") return { label: "Failed", tone: "error" };
  if (item.status === "invalid") return { label: "Needs attention", tone: "error" };
  if (item.status === "checking") return { label: "Checking", tone: "progress" };
  return { label: "Ready", tone: "success" };
}

export function App() {
  const isDemo = useMemo(() => new URLSearchParams(window.location.search).get("demo") === "1", []);
  const fileInput = useRef(null);
  const [items, setItems] = useState(isDemo ? demoItems : []);
  const [caption, setCaption] = useState(isDemo ? "Small moments, big memories.\nGrateful for the everyday adventures that shape us.\n\nWhich moment is your favorite?" : "");
  const [accounts, setAccounts] = useState(isDemo ? [{ _id: "demo", username: "@your.account", displayName: "Instagram account" }] : []);
  const [accountId, setAccountId] = useState(isDemo ? "demo" : "");
  const [configured, setConfigured] = useState(isDemo);
  const [accountLoading, setAccountLoading] = useState(!isDemo);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState({ current: 0, total: 0 });
  const [draggedItemId, setDraggedItemId] = useState("");
  const [preview, setPreview] = useState(null);
  const [editingNameId, setEditingNameId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [view, setView] = useState("publish");
  const [experiments, setExperiments] = useState(isDemo ? demoExperiments : []);
  const [selectedExperimentId, setSelectedExperimentId] = useState(isDemo ? demoExperiments[0].id : "");
  const [experimentLoading, setExperimentLoading] = useState(!isDemo);
  const [showNewExperiment, setShowNewExperiment] = useState(false);
  const [newExperimentSaving, setNewExperimentSaving] = useState(false);
  const [experimentForm, setExperimentForm] = useState({ name: "", hypothesis: "", primaryMetric: "views" });
  const [refreshingExperimentId, setRefreshingExperimentId] = useState("");
  const [deletingExperimentId, setDeletingExperimentId] = useState("");
  const [themePreference, setThemePreference] = useState(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      return VALID_THEMES.has(saved) ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches || false);

  const readyItems = getReadyItems(items);
  const readyCount = readyItems.length;
  const invalidCount = items.filter((item) => item.status === "invalid").length;
  const selectedExperiment = experiments.find((experiment) => experiment.id === selectedExperimentId) || null;
  const canPublish = !publishing && items.length > 0 && readyCount > 0 && invalidCount === 0 && Boolean(accountId) && Boolean(selectedExperimentId) && caption.trim().length > 0 && caption.length <= MAX_CAPTION;

  useEffect(() => {
    if (isDemo) return;
    refreshAccounts();
    refreshExperiments();
  }, [isDemo]);

  useEffect(() => {
    document.body.classList.add("trialr-v2-body");
    return () => document.body.classList.remove("trialr-v2-body");
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event) => setSystemDark(event.matches);
    setSystemDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const resolvedTheme = themePreference === "system" ? (systemDark ? "dark" : "light") : themePreference;
    document.documentElement.dataset.trialrTheme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // The selected theme still applies for this session when storage is unavailable.
    }
    return () => {
      delete document.documentElement.dataset.trialrTheme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [systemDark, themePreference]);

  useEffect(() => {
    if (!preview) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  async function refreshAccounts() {
    setAccountLoading(true);
    try {
      const status = await api("/api/zernio/status");
      setConfigured(status.configured);
      if (!status.configured) {
        setAccounts([]);
        setAccountId("");
        return;
      }
      const data = await api("/api/zernio/accounts");
      const instagramAccounts = data.accounts || [];
      setAccounts(instagramAccounts);
      setAccountId((current) => current && instagramAccounts.some((account) => account._id === current) ? current : instagramAccounts[0]?._id || "");
    } catch (error) {
      setNotice({ type: "error", text: normalizeError(error, "Could not load Instagram accounts.") });
    } finally {
      setAccountLoading(false);
    }
  }

  async function refreshExperiments() {
    setExperimentLoading(true);
    try {
      const data = await api("/api/experiments");
      const nextExperiments = data.experiments || [];
      setExperiments(nextExperiments);
      setSelectedExperimentId((current) => nextExperiments.some((experiment) => experiment.id === current) ? current : nextExperiments[0]?.id || "");
    } catch (error) {
      setNotice({ type: "error", text: normalizeError(error, "Could not load tests.") });
    } finally {
      setExperimentLoading(false);
    }
  }

  async function createExperiment(event) {
    event.preventDefault();
    if (!experimentForm.name.trim() || newExperimentSaving) return;
    setNewExperimentSaving(true);
    try {
      const data = await api("/api/experiments", {
        method: "POST",
        body: JSON.stringify(experimentForm),
      });
      setExperiments((current) => [data.experiment, ...current]);
      setSelectedExperimentId(data.experiment.id);
      setExperimentForm({ name: "", hypothesis: "", primaryMetric: "views" });
      setShowNewExperiment(false);
    } catch (error) {
      setNotice({ type: "error", text: normalizeError(error, "Could not create the test.") });
    } finally {
      setNewExperimentSaving(false);
    }
  }

  async function refreshExperimentAnalytics(experimentId) {
    if (isDemo) {
      setNotice({ type: "info", text: "Demo analytics are sample data. Connect Zernio to refresh real posts." });
      return;
    }
    if (refreshingExperimentId) return;
    setRefreshingExperimentId(experimentId);
    try {
      const data = await api(`/api/experiments/${experimentId}/refresh`, { method: "POST", body: "{}" });
      setExperiments((current) => current.map((experiment) => experiment.id === experimentId ? data.experiment : experiment));
    } catch (error) {
      setNotice({ type: "error", text: normalizeError(error, "Could not refresh analytics yet.") });
    } finally {
      setRefreshingExperimentId("");
    }
  }

  async function deleteExperiment(experimentId) {
    if (isDemo) {
      setNotice({ type: "info", text: "Demo tests are sample data and cannot be deleted." });
      return;
    }
    if (deletingExperimentId) return;
    setDeletingExperimentId(experimentId);
    try {
      await api(`/api/experiments/${experimentId}`, { method: "DELETE" });
      const remaining = experiments.filter((experiment) => experiment.id !== experimentId);
      setExperiments(remaining);
      if (selectedExperimentId === experimentId) setSelectedExperimentId(remaining[0]?.id || "");
      setNotice({ type: "success", text: "Test deleted." });
    } catch (error) {
      setNotice({ type: "error", text: normalizeError(error, "Could not delete the test.") });
    } finally {
      setDeletingExperimentId("");
    }
  }

  async function connectInstagram() {
    if (!configured) {
      setNotice({ type: "error", text: "Add ZERNIO_API_KEY to .env, restart Trialr, then connect Instagram." });
      return;
    }
    try {
      const profilesData = await api("/api/zernio/profiles");
      let profileId = profilesData.profiles?.[0]?._id;
      if (!profileId) {
        const created = await api("/api/zernio/profiles/default", { method: "POST", body: "{}" });
        profileId = created.profile?._id;
      }
      const redirectUrl = `${window.location.origin}${window.location.pathname}?connected=instagram`;
      const connection = await api("/api/zernio/connect", {
        method: "POST",
        body: JSON.stringify({ profileId, redirectUrl }),
      });
      window.location.assign(connection.authUrl);
    } catch (error) {
      setNotice({ type: "error", text: normalizeError(error, "Could not start Instagram connection.") });
    }
  }

  async function addFiles(fileList) {
    const available = MAX_FILES - items.length;
    const incoming = Array.from(fileList || []).slice(0, available);
    if (!incoming.length) {
      if (items.length >= MAX_FILES) setNotice({ type: "error", text: "A batch can contain up to 10 videos." });
      return;
    }

    const placeholders = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      thumbnail: "",
      duration: 0,
      width: 0,
      height: 0,
      errors: [],
      status: "checking",
      progress: 0,
    }));
    setItems((current) => [...current, ...placeholders]);

    const inspected = await Promise.all(incoming.map(inspectVideo));
    setItems((current) => {
      const placeholderIds = new Set(placeholders.map((item) => item.id));
      const preserved = current.filter((item) => !placeholderIds.has(item.id));
      return [...preserved, ...inspected].slice(0, MAX_FILES);
    });
  }

  function removeItem(id) {
    if (publishing) return;
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function moveItem(id, direction) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }

  function reorderDraggedItem(targetId) {
    if (!draggedItemId || draggedItemId === targetId || publishing) return;
    setItems((current) => reorderItems(current, draggedItemId, targetId));
  }

  function openPreview(item) {
    if (!item.file) return;
    setPreview({ name: item.name, url: URL.createObjectURL(item.file) });
  }

  function startRenaming(item) {
    if (publishing) return;
    setEditingNameId(item.id);
    setNameDraft(item.name);
  }

  function saveDisplayName(item) {
    updateItem(item.id, { name: normalizeDisplayName(nameDraft, item.name) });
    setEditingNameId("");
    setNameDraft("");
  }

  function cancelRenaming() {
    setEditingNameId("");
    setNameDraft("");
  }

  function updateItem(id, patch) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function platformState(post) {
    const target = post?.platforms?.find((platform) => platform.platform === "instagram") || post?.platforms?.[0];
    const status = target?.status || post?.status || "processing";
    return {
      status,
      url: target?.platformPostUrl || post?.platformPostUrl || "",
      platformPostId: target?.platformPostId || post?.platformPostId || "",
      publishedAt: target?.publishedAt || post?.publishedAt || "",
      error: target?.error || target?.errorMessage || post?.error || "",
    };
  }

  async function trackVariant(item, postId, state, mediaUrl) {
    if (!selectedExperimentId || !postId) return null;
    const data = await api(`/api/experiments/${selectedExperimentId}/variants`, {
      method: "POST",
      body: JSON.stringify({
        label: item.name,
        originalFilename: item.file?.name || item.name,
        zernioPostId: postId,
        platformPostId: state.platformPostId,
        platformPostUrl: state.url,
        mediaUrl,
        thumbnail: item.thumbnail,
        status: ["published", "success", "completed"].includes(state.status) ? "published" : state.status,
        publishedAt: state.publishedAt || new Date().toISOString(),
      }),
    });
    setExperiments((current) => current.map((experiment) => experiment.id === selectedExperimentId ? data.experiment : experiment));
    return data.variant;
  }

  async function pollPost(itemId, postId) {
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      try {
        const data = await api(`/api/zernio/posts/${postId}`);
        const state = platformState(data.post || data);
        if (["published", "success", "completed"].includes(state.status)) {
          updateItem(itemId, { status: "published", postUrl: state.url, error: "" });
          return;
        }
        if (["failed", "error", "cancelled"].includes(state.status)) {
          updateItem(itemId, { status: "failed", error: state.error || "Instagram could not publish this Reel." });
          return;
        }
      } catch {
        return;
      }
    }
  }

  async function publishItem(item) {
    if (!item.file) throw new Error("Demo videos cannot be published. Upload your own files first.");
    updateItem(item.id, { status: "uploading", progress: 0, error: "" });
    const presigned = await api("/api/zernio/presign", {
      method: "POST",
      body: JSON.stringify({
        filename: item.file.name,
        contentType: item.file.type || "video/mp4",
        size: item.file.size,
      }),
    });
    await uploadVideo(presigned.uploadUrl, item.file, (progress) => updateItem(item.id, { progress }));
    updateItem(item.id, { status: "publishing", progress: 100 });
    const created = await api("/api/zernio/posts", {
      method: "POST",
      body: JSON.stringify({
        accountId,
        mediaUrl: presigned.publicUrl,
        caption,
        requestId: crypto.randomUUID(),
        metadata: {
          trialrExperimentId: selectedExperimentId,
          trialrVariantLabel: item.name,
        },
      }),
    });
    const post = created.post || created.existingPost;
    const state = platformState(post);
    const postId = post?._id;

    if (["failed", "error", "cancelled"].includes(state.status)) {
      throw new Error(state.error || "Instagram could not publish this Reel.");
    }
    let trackingFailed = !postId;
    let trackedVariant = null;
    if (postId) {
      try {
        trackedVariant = await trackVariant(item, postId, state, presigned.publicUrl);
      } catch {
        trackingFailed = true;
        updateItem(item.id, { trackingError: "Published, but this variant was not added to the test." });
      }
    }
    if (["published", "success", "completed"].includes(state.status)) {
      updateItem(item.id, { status: "published", postId, postUrl: state.url, trackedVariantId: trackedVariant?.id });
      return { trackingFailed };
    }

    updateItem(item.id, { status: "processing", postId, postUrl: state.url, trackedVariantId: trackedVariant?.id });
    if (postId) pollPost(item.id, postId);
    return { trackingFailed };
  }

  async function publishBatch() {
    if (isDemo) {
      setNotice({ type: "info", text: "This is the visual demo. Remove these samples and upload your own videos to publish." });
      return;
    }
    if (!canPublish) return;
    const queue = readyItems;
    setPublishing(true);
    setPublishProgress({ current: 1, total: queue.length });
    setNotice(null);
    let failed = 0;
    let trackingFailed = 0;

    for (const [index, item] of queue.entries()) {
      setPublishProgress({ current: index + 1, total: queue.length });
      try {
        const result = await publishItem(item);
        if (result?.trackingFailed) trackingFailed += 1;
      } catch (error) {
        failed += 1;
        updateItem(item.id, { status: "failed", error: normalizeError(error, "Publishing failed.") });
      }
    }

    setPublishing(false);
    setPublishProgress({ current: 0, total: 0 });
    const submitted = queue.length - failed;
    let noticeText = failed ? `${submitted} Reel${submitted === 1 ? "" : "s"} submitted. ${failed} failed and can be retried.` : `${queue.length} Trial Reel${queue.length === 1 ? "" : "s"} submitted to Instagram.`;
    if (trackingFailed) noticeText += ` ${trackingFailed} published Reel${trackingFailed === 1 ? " was" : "s were"} not added to the test.`;
    setNotice({
      type: failed || trackingFailed ? "error" : "success",
      text: noticeText,
    });
  }

  async function retryItem(item) {
    if (publishing || item.status !== "failed") return;
    setPublishing(true);
    setPublishProgress({ current: 1, total: 1 });
    try {
      await publishItem(item);
    } catch (error) {
      updateItem(item.id, { status: "failed", error: normalizeError(error, "Publishing failed.") });
    } finally {
      setPublishing(false);
      setPublishProgress({ current: 0, total: 0 });
    }
  }

  function newBatch() {
    if (publishing) return;
    setItems([]);
    setCaption("");
    setNotice(null);
    setPublishProgress({ current: 0, total: 0 });
  }

  const publishLabel = getPublishLabel({
    publishing,
    current: publishProgress.current,
    total: publishProgress.total,
    readyCount,
  });

  const newExperimentModal = showNewExperiment && (
    <div className="experiment-modal-backdrop experiment-modal-backdrop-v2" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNewExperiment(false); }}>
      <form className="experiment-modal experiment-modal-v2" onSubmit={createExperiment} aria-label="Create a new test">
        <div className="experiment-modal-header">
          <div><span className="eyebrow">New experiment</span><h2>Create a test</h2></div>
          <button type="button" onClick={() => setShowNewExperiment(false)} aria-label="Close new test"><IconX size={21} /></button>
        </div>
        <label>
          <span>Test name</span>
          <input autoFocus value={experimentForm.name} onChange={(event) => setExperimentForm((current) => ({ ...current, name: event.target.value }))} maxLength={100} placeholder="Pink text vs. red text" />
        </label>
        <label>
          <span>Hypothesis <i>Optional</i></span>
          <textarea value={experimentForm.hypothesis} onChange={(event) => setExperimentForm((current) => ({ ...current, hypothesis: event.target.value }))} maxLength={240} placeholder="Pink opening text will hold attention longer." />
        </label>
        <label>
          <span>Primary metric</span>
          <select value={experimentForm.primaryMetric} onChange={(event) => setExperimentForm((current) => ({ ...current, primaryMetric: event.target.value }))}>
            {METRIC_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="experiment-modal-actions">
          <button type="button" onClick={() => setShowNewExperiment(false)}>Cancel</button>
          <button type="submit" disabled={!experimentForm.name.trim() || newExperimentSaving}>{newExperimentSaving ? <IconLoader2 className="spin" size={18} /> : <IconPlus size={18} />} Create test</button>
        </div>
      </form>
    </div>
  );

  if (view === "experiments") {
    return (
      <>
        <ExperimentsView
          experiments={experiments}
          selectedExperimentId={selectedExperimentId}
          onSelectExperiment={setSelectedExperimentId}
          onBack={() => setView("publish")}
          onNewExperiment={() => setShowNewExperiment(true)}
          onRefreshExperiment={refreshExperimentAnalytics}
          refreshingExperimentId={refreshingExperimentId}
          onDeleteExperiment={deleteExperiment}
          deletingExperimentId={deletingExperimentId}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
        />
        {newExperimentModal}
      </>
    );
  }

  return (
    <>
    <main className="app-shell app-v2">
      <section className="batch-pane" aria-label="Trial Reel batch">
        <header className="topbar">
          <button className="wordmark" type="button" onClick={newBatch} aria-label="Start a new Trialr batch">
            <span className="v2-brand-mark"><IconBrandInstagram size={16} stroke={1.7} /></span>
            <span>Trialr</span>
          </button>
          <div className="topbar-actions">
            <ThemeToggle value={themePreference} onChange={setThemePreference} />
            <button className="new-batch" type="button" onClick={newBatch}>New batch</button>
            <button className="tests-nav-button" type="button" onClick={() => setView("experiments")}><IconFlask size={18} /> Tests{experiments.length ? <span>{experiments.length}</span> : null}</button>
          </div>
        </header>

        <div className="v2-system-label"><IconPointFilled size={13} /> SYS_TRIAL_READY <span>// 01</span></div>
        <div className="batch-heading">
          <h1>Videos</h1>
          {items.length > 0 && <span className={invalidCount ? "count-badge count-badge-error" : "count-badge"}>{invalidCount ? `${invalidCount} issue${invalidCount === 1 ? "" : "s"}` : `${readyCount} ready`}</span>}
        </div>

        <button
          className={`dropzone ${dragActive ? "dropzone-active" : ""}`}
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }}
          disabled={publishing || items.length >= MAX_FILES}
        >
          <IconUpload size={36} stroke={1.8} aria-hidden="true" />
          <span className="dropzone-copy">
            <strong>{items.length >= MAX_FILES ? "Batch is full" : "Upload up to 10 vertical videos"}</strong>
            <span>Drag and drop files here, or click to browse</span>
          </span>
        </button>
        <input ref={fileInput} className="visually-hidden" type="file" accept="video/mp4,video/quicktime,video/x-m4v" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />

        <div className="video-list" aria-live="polite">
          {items.length === 0 ? (
            <div className="empty-state">
              <span>Your batch is empty.</span>
              <span>Add vertical MP4 or MOV videos between 3 and 90 seconds.</span>
            </div>
          ) : items.map((item) => {
            const state = itemState(item);
            return (
              <article
                className={`video-row video-row-${state.tone} ${draggedItemId === item.id ? "video-row-dragging" : ""}`}
                key={item.id}
                onDragEnter={() => reorderDraggedItem(item.id)}
                onDragOver={(event) => event.preventDefault()}
              >
                <div
                  className="drag-handle"
                  role="button"
                  tabIndex={publishing ? -1 : 0}
                  draggable={!publishing}
                  aria-label={`Drag to reorder ${item.name}`}
                  aria-pressed={draggedItemId === item.id}
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    setDraggedItemId(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => setDraggedItemId("")}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    moveItem(item.id, event.key === "ArrowUp" ? -1 : 1);
                  }}
                >
                  <IconGripVertical size={22} stroke={1.7} aria-hidden="true" />
                </div>
                <button className="thumbnail-wrap" type="button" onClick={() => openPreview(item)} disabled={!item.file} aria-label={`Preview ${item.name}`}>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" className="video-thumbnail" /> : <div className="thumbnail-loading"><IconLoader2 className="spin" size={22} /></div>}
                  {item.duration > 0 && <span className="duration">{formatDuration(item.duration)}</span>}
                  {item.file && <span className="preview-overlay" aria-hidden="true"><IconEye size={20} stroke={1.8} /></span>}
                </button>
                <div className="video-copy">
                  {editingNameId === item.id ? (
                    <input
                      className="video-name-input"
                      value={nameDraft}
                      maxLength={120}
                      autoFocus
                      aria-label={`Rename ${item.name}`}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onBlur={() => saveDisplayName(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveDisplayName(item);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenaming();
                        }
                      }}
                    />
                  ) : (
                    <button className="video-name-button" type="button" title="Click to rename" onClick={() => startRenaming(item)} disabled={publishing}>{item.name}</button>
                  )}
                  <span>{item.width || "--"}×{item.height || "--"} <i>•</i> {formatDuration(item.duration)} <i>•</i> {formatSize(item.size)}</span>
                  {item.error && <span className="row-error">{item.error}</span>}
                  {item.trackingError && <span className="row-error">{item.trackingError}</span>}
                  {!item.error && item.errors?.length > 0 && <span className="row-error">{item.errors[0]}</span>}
                  {state.tone === "progress" && <span className="progress-track"><span style={{ width: `${item.status === "uploading" ? item.progress : 100}%` }} /></span>}
                </div>
                <div className={`row-state row-state-${state.tone}`}>
                  {state.tone === "success" ? <IconCircleCheck size={22} /> : state.tone === "error" ? <IconCircleX size={22} /> : <IconLoader2 className="spin" size={22} />}
                  <span>{state.label}</span>
                </div>
                <div className="row-actions">
                  {item.status === "failed" && (
                    <button className="icon-button retry-button" type="button" onClick={() => retryItem(item)} aria-label={`Retry ${item.name}`} title="Retry">
                      <IconRefresh size={21} />
                    </button>
                  )}
                  <button className="icon-button delete-button" type="button" onClick={() => removeItem(item.id)} disabled={publishing} aria-label={`Remove ${item.name}`} title="Remove video">
                    <IconTrash size={22} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="video-footer">
          <span>{items.length} of {MAX_FILES} videos</span>
          {items.length > 0 && !publishing && <button type="button" onClick={() => setItems([])}>Clear all</button>}
        </footer>
      </section>

      <aside className="publish-pane" aria-label="Publishing settings">
        <div className="v2-console-header">
          <span><IconPointFilled size={13} /> PUBLISHING_CONSOLE // V2</span>
          <strong>Configure <em>dispatch.</em></strong>
          <p>One controlled batch. One shared caption. Every result tracked.</p>
        </div>
        <section className="setting-section experiment-picker-section">
          <div className="section-heading">
            <h2>Test</h2>
            <button className="new-test-inline" type="button" onClick={() => setShowNewExperiment(true)}><IconPlus size={16} /> New</button>
          </div>
          {experimentLoading ? (
            <div className="experiment-picker-loading"><IconLoader2 className="spin" size={19} /> Loading tests</div>
          ) : experiments.length ? (
            <>
              <label className="experiment-picker-control">
                <span className="experiment-picker-icon"><IconFlask size={20} /></span>
                <select value={selectedExperimentId} onChange={(event) => setSelectedExperimentId(event.target.value)} aria-label="Active test">
                  {experiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}
                </select>
                <IconChevronDown size={20} aria-hidden="true" />
              </label>
              <p>{selectedExperiment?.variants.length || 0} saved variant{selectedExperiment?.variants.length === 1 ? "" : "s"} · Winner by {metricLabel(selectedExperiment?.primaryMetric)}</p>
            </>
          ) : (
            <button className="create-first-test" type="button" onClick={() => setShowNewExperiment(true)}><IconPlus size={18} /> Create your first test</button>
          )}
        </section>
        <section className="setting-section account-section">
          <div className="section-heading">
            <h2>Instagram account</h2>
            {!isDemo && <button className="refresh-button" type="button" onClick={refreshAccounts} aria-label="Refresh Instagram accounts" title="Refresh accounts"><IconRefresh size={18} className={accountLoading ? "spin" : ""} /></button>}
          </div>
          {accountLoading ? (
            <div className="account-control account-loading"><IconLoader2 className="spin" size={20} /> Loading accounts</div>
          ) : accounts.length ? (
            <label className="account-control">
              <span className="account-avatar"><IconBrandInstagram size={20} aria-hidden="true" /></span>
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Instagram account">
                {accounts.map((account) => <option key={account._id} value={account._id}>{account.username?.startsWith("@") ? account.username : `@${account.username || account.displayName}`}</option>)}
              </select>
              <IconChevronDown size={21} aria-hidden="true" />
            </label>
          ) : (
            <button className="account-control connect-control" type="button" onClick={connectInstagram}>
              <span className="account-avatar"><IconBrandInstagram size={20} /></span>
              <span>{configured ? "Connect Instagram" : "Configure Zernio"}</span>
              <IconChevronRight size={21} />
            </button>
          )}
          {!configured && !accountLoading && (
            <div className="config-note">
              <IconSettings size={17} />
              <span>Add <code>ZERNIO_API_KEY</code> to <code>.env</code>, then restart the app.</span>
            </div>
          )}
        </section>

        <section className="setting-section caption-section">
          <div className="section-heading">
            <h2>Caption for every reel</h2>
            <span className={caption.length > MAX_CAPTION ? "character-count over-limit" : "character-count"}>{caption.length.toLocaleString()} / {MAX_CAPTION.toLocaleString()}</span>
          </div>
          <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={MAX_CAPTION + 200} placeholder="Write one caption for every Trial Reel..." aria-label="Caption for every reel" />
          <p>This caption will be used for all {readyCount || "your"} ready reels.</p>
        </section>

        <section className="setting-section trial-section">
          <div className="section-heading trial-heading">
            <h2>Trial Reel</h2>
            <span className="info-dot" title="Trial Reels are shown to non-followers first">i</span>
          </div>
          <div className="trial-setting">
            <IconSchool size={43} stroke={1.6} aria-hidden="true" />
            <div>
              <strong>Manual graduation</strong>
              <span>You’ll decide when each reel graduates to a full reel on Instagram.</span>
            </div>
            <IconChevronRight size={23} aria-hidden="true" />
          </div>
        </section>

        <div className="publish-area">
          {notice && (
            <div className={`notice notice-${notice.type}`} role="status">
              {notice.type === "success" ? <IconCircleCheck size={20} /> : notice.type === "info" ? <IconAlertCircle size={20} /> : <IconAlertCircle size={20} />}
              <span>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><IconX size={17} /></button>
            </div>
          )}
          <button className="publish-button" type="button" disabled={!canPublish} onClick={publishBatch}>
            {publishing ? <IconLoader2 className="spin" size={25} /> : <IconSend2 size={27} stroke={1.8} />}
            <span>{publishLabel}</span>
          </button>
          <p>Each video will be published as an Instagram Trial Reel.<br />One post per video. Same caption on all.</p>
        </div>
      </aside>
      {preview && (
        <div className="preview-lightbox" role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <div className="preview-dialog">
            <div className="preview-header">
              <strong>{preview.name}</strong>
              <button type="button" autoFocus onClick={() => setPreview(null)} aria-label="Close video preview"><IconX size={22} /></button>
            </div>
            <video src={preview.url} controls autoPlay playsInline aria-label={preview.name} />
          </div>
        </div>
      )}
    </main>
    {newExperimentModal}
    </>
  );
}
