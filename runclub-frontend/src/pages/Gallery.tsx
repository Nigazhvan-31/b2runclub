import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DownloadIcon, SparkIcon, UsersIcon } from "../components/icons";
import { Page, PageHeader } from "../components/layout";
import { PageScene } from "../components/scene3d";
import { Tilt } from "../components/tilt";
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn, eventDate, relativeTime, ROLE_META } from "../lib/format";
import { DUR, EASE } from "../lib/motion";
import type { Photo } from "../lib/types";
import { useFetch } from "../lib/useFetch";

/** Max raw file size allowed to be selected (25MB). Auto-optimised client-side before network upload. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";

/**
 * Ensures any image file of any pixel dimension or size (landscape, portrait, square, panorama)
 * is optimised to fit comfortably within upload and display limits without visual quality loss.
 */
async function optimiseImageFile(
  file: File,
): Promise<{ file: File; dimensions: { width: number; height: number; orientation: string } }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return { file, dimensions: { width: 0, height: 0, orientation: "image" } };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const origWidth = img.naturalWidth || img.width;
        const origHeight = img.naturalHeight || img.height;
        const orientation =
          origWidth > origHeight * 1.15
            ? "Landscape"
            : origHeight > origWidth * 1.15
              ? "Portrait"
              : "Square";

        const MAX_DIM = 2560; // 2.5K pixels: pin-sharp for 4K displays and phones alike
        let targetWidth = origWidth;
        let targetHeight = origHeight;

        if (targetWidth > targetHeight) {
          if (targetWidth > MAX_DIM) {
            targetHeight = Math.round((targetHeight * MAX_DIM) / targetWidth);
            targetWidth = MAX_DIM;
          }
        } else {
          if (targetHeight > MAX_DIM) {
            targetWidth = Math.round((targetWidth * MAX_DIM) / targetHeight);
            targetHeight = MAX_DIM;
          }
        }

        // If image is already reasonably sized (< 2MB and under MAX_DIM), preserve exact original
        if (origWidth <= MAX_DIM && origHeight <= MAX_DIM && file.size <= 2 * 1024 * 1024) {
          resolve({ file, dimensions: { width: origWidth, height: origHeight, orientation } });
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ file, dimensions: { width: origWidth, height: origHeight, orientation } });
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ file, dimensions: { width: origWidth, height: origHeight, orientation } });
              return;
            }
            const cleanName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
            const processed = new File([blob], cleanName, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve({
              file: processed,
              dimensions: { width: targetWidth, height: targetHeight, orientation },
            });
          },
          "image/jpeg",
          0.88,
        );
      };
      img.onerror = () => resolve({ file, dimensions: { width: 0, height: 0, orientation: "image" } });
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve({ file, dimensions: { width: 0, height: 0, orientation: "image" } });
    reader.readAsDataURL(file);
  });
}

export function Gallery() {
  const { role, user } = useAuth();
  const toast = useToast();

  const load = useCallback(() => api.gallery(), []);
  const { data, loading, error, reload, setData } = useFetch(load);

  /** Club members, volunteers and admins can all add photos. */
  const canPost = Boolean(user && role !== "VISITOR");
  const isAdmin = role === "ADMIN";

  const [uploadOpen, setUploadOpen] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>("all");

  const all = data ?? [];

  /**
   * Events that actually have photos, so the filter never offers a session with
   * nothing behind it. Ordered by how recently a photo was posted.
   */
  const taggedEvents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of all) {
      if (p.event_id && !seen.has(p.event_id)) {
        seen.set(p.event_id, p.event_title ?? "Untitled session");
      }
    }
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }, [all]);

  const photos =
    eventFilter === "all"
      ? all
      : eventFilter === "untagged"
        ? all.filter((p) => !p.event_id)
        : all.filter((p) => p.event_id === eventFilter);

  const canDelete = (p: Photo) => isAdmin || p.uploader.id === user?.id;

  const remove = async (p: Photo) => {
    setRemoving(p.id);
    try {
      await api.deletePhoto(p.id);
      setData((prev) => (prev ?? []).filter((x) => x.id !== p.id));
      setLightbox(null);
      toast("Photo removed.", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove the photo", "err");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Page>
      <PageScene variant="frames" opacity={0.3} />
      <PageHeader
        eyebrow="Club gallery"
        title="Gallery"
        description="Shots from the road, the trail and the after-party, posted by the B² community."
        action={
          canPost ? (
            <Button onClick={() => setUploadOpen(true)}>
              <SparkIcon className="size-3.5" />
              Add photos
            </Button>
          ) : user ? (
            <Button onClick={() => setUploadOpen(true)}>
              <SparkIcon className="size-3.5" />
              Add photos
            </Button>
          ) : (
            <Link to="/login" className={buttonClass("outline", "md")}>
              Sign in to contribute
            </Link>
          )
        }
      />

      {/* Filter by session — only worth showing once something is tagged. */}
      {taggedEvents.length > 0 && (
        <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
          {[
            { id: "all", title: `Everything (${all.length})` },
            ...taggedEvents,
            ...(all.some((p) => !p.event_id) ? [{ id: "untagged", title: "Untagged" }] : []),
          ].map((opt) => {
            const active = eventFilter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setEventFilter(opt.id)}
                aria-pressed={active}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  active
                    ? "border-gold bg-gold text-[color:var(--color-gold-ink)]"
                    : "border-white/10 text-ink-3 hover:border-gold/40 hover:text-ink-2",
                )}
              >
                {opt.title}
              </button>
            );
          })}
        </div>
      )}

      {/* View-only notice for visitors */}
      {!canPost && !loading && photos.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-surface/60 px-4 py-3 text-[13px] text-ink-3">
          <p className="flex items-center gap-2">
            <UsersIcon className="size-4 shrink-0" />
            Club members can share photos from runs and club sessions.
          </p>
          <Link to="/login" className={buttonClass("outline", "sm")}>
            Sign in to add photos →
          </Link>
        </div>
      )}

      {loading ? (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {[280, 200, 340, 240, 300, 220].map((h, i) => (
            <Skeleton key={i} className="mb-4 w-full" style={{ height: h }} />
          ))}
        </div>
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : photos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SparkIcon className="size-5" />}
            title="No photos yet"
            body={
              canPost
                ? "Add the first one — a start line, a finish, a muddy shoe."
                : "Nothing posted yet. Check back after the next session."
            }
            action={
              canPost && (
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  Add photos
                </Button>
              )
            }
          />
        </Card>
      ) : (
        /* Masonry via CSS columns — accommodates any aspect ratio naturally without distortion */
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
          {photos.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.reveal, delay: Math.min(i * 0.04, 0.3), ease: EASE }}
              className="break-inside-avoid"
            >
              <Tilt max={6} lift={8}>
                <button
                  onClick={() => setLightbox(p)}
                  className="group relative block w-full overflow-hidden rounded-[var(--radius-card)] border border-white/8 bg-surface/40 text-left transition-colors hover:border-gold/40"
                  aria-label={p.caption ?? `Photo by ${p.uploader.name}`}
                >
                  <img
                    src={p.url}
                    alt={p.caption ?? `Club photo by ${p.uploader.name}`}
                    loading="lazy"
                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />

                  {/* Caption plate — visible on hover on desktop, subtly overlaid on touch devices */}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-void/95 via-void/70 to-transparent p-4 transition-all duration-300 opacity-90 sm:opacity-0 sm:translate-y-2 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
                    {p.caption && (
                      <span className="block text-[13px] font-medium leading-snug text-ink drop-shadow-sm">
                        {p.caption}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-ink-3">
                      {p.uploader.name} · {relativeTime(p.created_at)}
                    </span>
                  </span>
                </button>
              </Tilt>
            </motion.div>
          ))}
        </div>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onAdded={(photo) => {
          setData((prev) => [photo, ...(prev ?? [])]);
          toast("Photo added to the gallery.", "ok");
        }}
      />

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <div className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-6 lg:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLightbox(null)}
              className="absolute inset-0 bg-void/95 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: DUR.base, ease: EASE }}
              className="relative max-h-full w-full max-w-5xl flex flex-col items-center"
            >
              <div className="relative max-h-[76vh] max-w-full overflow-hidden rounded-2xl border border-white/12 bg-black/70 shadow-2xl flex items-center justify-center">
                <img
                  src={lightbox.url}
                  alt={lightbox.caption ?? "Club photo"}
                  className="max-h-[76vh] w-auto max-w-full object-contain block select-none"
                />
              </div>

              <div className="mt-4 flex w-full max-w-4xl flex-wrap items-center gap-3 px-2">
                <Avatar name={lightbox.uploader.name} size={34} />
                <div className="min-w-0 flex-1">
                  {lightbox.caption && (
                    <p className="text-[14px] font-medium text-ink">{lightbox.caption}</p>
                  )}
                  <p className="text-[12px] text-ink-3">
                    {lightbox.uploader.name} ·{" "}
                    {(ROLE_META[lightbox.uploader.role] ?? ROLE_META.MEMBER).label} ·{" "}
                    {relativeTime(lightbox.created_at)}
                  </p>
                </div>

                <a
                  href={lightbox.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass("outline", "sm")}
                >
                  <DownloadIcon className="size-3.5" />
                  Open full size
                </a>

                {canDelete(lightbox) && (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={removing === lightbox.id}
                    onClick={() => remove(lightbox)}
                  >
                    Delete
                  </Button>
                )}

                <Button size="sm" variant="ghost" onClick={() => setLightbox(null)}>
                  Close
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Page>
  );
}

/* ── Upload ───────────────────────────────────────────────── */

function UploadModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (photo: Photo) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number; orientation: string }>({
    width: 0,
    height: 0,
    orientation: "",
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimising, setOptimising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sessions to tag against. Past events first — a photo is nearly always of one
  // that has already happened.
  const loadEvents = useCallback(() => api.events(), []);
  const { data: events } = useFetch(loadEvents);
  const taggable = useMemo(
    () =>
      [...(events ?? [])].sort(
        (a, b) => +new Date(b.date_time) - +new Date(a.date_time),
      ),
    [events],
  );

  useEffect(() => {
    if (open) {
      setFile(null);
      setImageDims({ width: 0, height: 0, orientation: "" });
      setCaption("");
      setLinkUrl("");
      setEventId("");
      setError(null);
      setDragging(false);
      setOptimising(false);
    }
  }, [open]);

  // Object URLs must be revoked or the blob leaks for the page's lifetime.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const accept = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose a valid image file (JPEG, PNG, WebP, GIF or AVIF).");
      return;
    }
    if (f.size > MAX_INPUT_BYTES) {
      setError(`That image is ${(f.size / 1024 / 1024).toFixed(1)}MB — please choose an image under 25MB.`);
      return;
    }
    setError(null);
    setOptimising(true);
    try {
      const { file: optimised, dimensions } = await optimiseImageFile(f);
      setFile(optimised);
      setImageDims(dimensions);
    } catch {
      setFile(f);
    } finally {
      setOptimising(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!file && !linkUrl.trim()) {
      setError("Choose an image or paste an image URL.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.addPhoto({
        file: file ?? undefined,
        url: file ? undefined : linkUrl.trim(),
        caption: caption.trim() || undefined,
        event_id: eventId || undefined,
      });
      onAdded(res.photo);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a photo"
      subtitle="Any size, resolution or orientation (landscape, portrait, square)."
      size="lg"
    >
      <form onSubmit={submit} className="space-y-5">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "grid cursor-pointer place-items-center rounded-xl border border-dashed p-4 sm:p-6 text-center transition-colors",
            dragging ? "border-gold bg-gold/8" : "border-white/14 hover:border-gold/45",
          )}
        >
          {optimising ? (
            <div className="py-8">
              <span className="mx-auto block size-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              <p className="mt-3 text-[13px] text-ink-2">Fitting and optimising photo dimensions…</p>
            </div>
          ) : preview ? (
            <div className="w-full">
              <div className="mx-auto flex h-60 w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-void/60 p-2">
                <img
                  src={preview}
                  alt="Preview"
                  className="max-h-full max-w-full rounded-lg object-contain shadow-lg"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-ink-3">
                <span className="font-medium text-ink-2 truncate max-w-[200px] sm:max-w-xs">{file?.name}</span>
                <span>
                  {imageDims.width > 0 ? `${imageDims.width} × ${imageDims.height} (${imageDims.orientation}) · ` : ""}
                  {((file?.size ?? 0) / 1024).toFixed(0)} KB · Click to replace
                </span>
              </div>
            </div>
          ) : (
            <div>
              <span className="mx-auto grid size-10 place-items-center rounded-xl border border-gold/25 bg-gold/8 text-gold">
                <SparkIcon className="size-[18px]" />
              </span>
              <p className="mt-3 text-[13.5px] font-medium text-ink">
                Drop an image here, or click to choose
              </p>
              <p className="mt-1 text-[12px] text-ink-3">Any pixel size, orientation (landscape or portrait) or camera roll photo</p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => accept(e.target.files?.[0])}
          />
        </div>

        <Field label="Caption" htmlFor="ph-caption" hint="Optional, but it helps people find it.">
          <Input
            id="ph-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. WEEK 27 Trekking at Samanar Hill"
            maxLength={160}
          />
        </Field>

        <Field
          label="From which session?"
          htmlFor="ph-event"
          hint="Optional. Tagged photos also appear on that event's page."
        >
          <Select id="ph-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Not tied to an event</option>
            {taggable.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} — {eventDate(ev.date_time)}
              </option>
            ))}
          </Select>
        </Field>

        {!file && (
          <Field
            label="…or paste an image URL"
            htmlFor="ph-url"
            hint="Use this if the photo already lives somewhere online."
          >
            <Input
              id="ph-url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              inputMode="url"
            />
          </Field>
        )}

        {error && (
          <p className="rounded-lg border border-[color:var(--color-failed)]/30 bg-[color:var(--color-failed)]/8 px-3 py-2 text-[13px] text-ink-2">
            <span aria-hidden className="mr-1.5 font-bold text-[color:var(--color-failed)]">
              !
            </span>
            {error}
          </p>
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" loading={busy || optimising} className="flex-1">
            Add to gallery
          </Button>
        </div>
      </form>
    </Modal>
  );
}
