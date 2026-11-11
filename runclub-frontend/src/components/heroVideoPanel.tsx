import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useBranch } from "../lib/branch";
import { useFetch } from "../lib/useFetch";
import { videoKind, youtubeEmbedUrl, youtubeId } from "../lib/video";
import { Button, Card, Field, Input, useToast } from "./ui";

/**
 * The cap that actually applies now.
 *
 * It used to be the platform's 4.5MB request-body limit, because the file was
 * posted through the API. Uploads go browser → object storage via a signed URL
 * instead, so the function never sees the bytes and that limit no longer binds.
 */
const MAX_MB = 200;

/**
 * Organiser control for the home page background video.
 *
 * Two ways in, because neither covers everything on its own: a YouTube link
 * costs nothing to host and streams at any size, and an uploaded file avoids
 * YouTube's branding and works without a third party. The player works out
 * which it has been given from the value, so there is no type to pick.
 */
export function HeroVideoPanel() {
  const toast = useToast();
  const { adminBranch } = useBranch();
  const [activeTab, setActiveTab] = useState<"MADURAI" | "CHENNAI">(() =>
    adminBranch === "CHENNAI" ? "CHENNAI" : "MADURAI",
  );

  useEffect(() => {
    if (adminBranch === "CHENNAI") setActiveTab("CHENNAI");
    else if (adminBranch === "MADURAI") setActiveTab("MADURAI");
  }, [adminBranch]);

  const isChennai = activeTab === "CHENNAI";
  const targetField = isChennai ? "hero_video_url_chennai" : "hero_video_url";

  const load = useCallback(() => api.clubInfo(), []);
  const { data: club, setData } = useFetch(load);

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 0-1 while a file is going up. A 50MB upload with no feedback looks stuck. */
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const val = isChennai ? club?.hero_video_url_chennai : club?.hero_video_url;
    setUrl(val ?? "");
  }, [club, isChennai]);

  const current = (isChennai ? club?.hero_video_url_chennai : club?.hero_video_url) ?? null;
  const trimmed = url.trim();
  const dirty = trimmed !== (current ?? "");
  const kind = videoKind(trimmed);
  const ytId = kind === "youtube" ? youtubeId(trimmed) : null;

  const save = async (next: string) => {
    setBusy(true);
    try {
      const { club: updated } = await api.saveClubInfo({ [targetField]: next });
      setData(() => updated);
      setUrl((isChennai ? updated.hero_video_url_chennai : updated.hero_video_url) ?? "");
      toast(next ? `${isChennai ? "Chennai" : "Madurai"} hero video updated.` : "Hero video removed.", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "err");
    } finally {
      setBusy(false);
    }
  };

  /** Uploads, then saves the returned URL — one action from the organiser's side. */
  const pickFile = async (file: File) => {
    const mb = file.size / 1024 / 1024;
    if (mb > MAX_MB) {
      toast(`That file is ${mb.toFixed(0)}MB. The limit is ${MAX_MB}MB.`, "err");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const { url: stored } = await api.uploadVideo(file, setProgress);
      await save(stored);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "err");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Home Page Background Video</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
            Manage looping hero videos for each chapter. Chennai and Madurai have separate videos.
          </p>
        </div>

        {/* Chapter Switcher Tabs */}
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("MADURAI")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "MADURAI"
                ? "bg-gold text-[color:var(--color-gold-ink)] shadow"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            🏛️ Madurai Video
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("CHENNAI")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "CHENNAI"
                ? "bg-sky-400 text-stone-950 shadow"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            🌊 Chennai Video
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-white/8 bg-surface-2/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-block size-2 rounded-full ${isChennai ? "bg-sky-400" : "bg-gold"}`} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
            Editing {isChennai ? "Chennai Chapter" : "Madurai Chapter"} Hero Video
          </h3>
          {current ? (
            <span className="ml-auto text-[11px] text-emerald-400 font-medium">● Video Active</span>
          ) : (
            <span className="ml-auto text-[11px] text-ink-3 font-medium">○ Using 3D Scene</span>
          )}
        </div>

        <Field
          label={`${isChennai ? "Chennai" : "Madurai"} Video Link or File`}
          htmlFor="hero-video"
          hint="Paste a YouTube URL (watch, shorts, embed) or upload an MP4/WebM file."
        >
          <Input
            id="hero-video"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=… or uploaded .mp4"
            inputMode="url"
          />
        </Field>

        {trimmed && (
          <p className="mt-2 text-[12px] text-ink-3">
            Reads as{" "}
            <span className="font-semibold text-gold">
              {kind === "youtube" ? "a YouTube video" : "a video file"}
            </span>
            {kind === "youtube" && ytId ? ` (${ytId})` : ""}.
          </p>
        )}

        {/* Silent preview */}
        {trimmed && (
          <div className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-surface-2/60">
            {kind === "youtube" && ytId ? (
              <iframe
                key={ytId}
                title="Hero video preview"
                src={youtubeEmbedUrl(ytId)}
                allow="autoplay; encrypted-media"
                className="aspect-video w-full border-0"
              />
            ) : (
              <video
                key={trimmed}
                src={trimmed}
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                className="aspect-video w-full object-cover"
              />
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button loading={busy && !uploading} disabled={!dirty} onClick={() => void save(trimmed)}>
            Save {isChennai ? "Chennai" : "Madurai"} Video
          </Button>
          <Button
            variant="outline"
            loading={uploading}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {uploading && progress > 0
              ? `Uploading ${Math.round(progress * 100)}%`
              : `Upload ${isChennai ? "Chennai" : "Madurai"} File`}
          </Button>
          {current && (
            <Button
              variant="ghost"
              disabled={busy || uploading}
              onClick={() => {
                setUrl("");
                void save("");
              }}
            >
              Remove
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pickFile(f);
            }}
          />
        </div>

        {uploading && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-200"
              style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
            />
          </div>
        )}
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-3">
        Up to {MAX_MB}MB. If no video is uploaded for a chapter, that chapter gracefully displays the high-performance 3D scene.
      </p>
    </Card>
  );
}
