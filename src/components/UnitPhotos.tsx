"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X, Trash2, ChevronLeft, ChevronRight, Loader2, RotateCw } from "lucide-react";
import { preparePhoto, uploadPhoto, PhotoError, type UploadedPhoto } from "@/lib/photos-client";

/**
 * The unit's nameplate photos.
 *
 * On the unit card: a row of thumbnails; a click opens the photo large in the centre with the
 * rest as a strip below. In the passport popup (`editable`): the same row with an "Add photo"
 * tile and a remove button on each. Uploads run in the background with retries, so the passport
 * fields save at once and a photo taken on a roof with a weak signal follows when it can.
 */

const MAX = 5;

interface Pending {
  key: string;
  state: "preparing" | "uploading" | "retrying" | "failed";
  message?: string;
  file: File;
}

/**
 * A photo that tries once more if it fails to load. Each photo is fetched through our route,
 * which checks access and then redirects to a signed link; a hiccup on either hop should not
 * leave a broken image on the card.
 */
export function PhotoImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={() => {
        if (attempt < 2) setTimeout(() => setAttempt((a) => a + 1), 600 * (attempt + 1));
      }}
    />
  );
}

export function usePhotos(unitId: string) {
  const [photos, setPhotos] = useState<UploadedPhoto[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [storage, setStorage] = useState<string>("local");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/units/${unitId}/photos`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { photos: UploadedPhoto[]; canEdit: boolean; storage: string } | null) => {
        if (!alive || !d) return;
        setPhotos(d.photos);
        setCanEdit(d.canEdit);
        setStorage(d.storage);
      });
    return () => { alive = false; };
  }, [unitId, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { photos, setPhotos, canEdit, storage, reload };
}

export function Lightbox({ photos, index, onClose }: { photos: UploadedPhoto[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const go = useCallback((d: number) => setI((x) => (x + d + photos.length) % photos.length), [photos.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);
  const p = photos[i];
  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-ink/90 p-4" onClick={onClose}>
      <div className="flex justify-end">
        <button title="Close" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"><X size={20} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
        {photos.length > 1 && <button title="Previous" onClick={() => go(-1)} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronLeft size={20} /></button>}
        <PhotoImg src={p.url} alt="Nameplate" className="max-h-full max-w-full rounded-lg object-contain" />
        {photos.length > 1 && <button title="Next" onClick={() => go(1)} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronRight size={20} /></button>}
      </div>
      <div className="mt-3 flex justify-center gap-2" onClick={(e) => e.stopPropagation()}>
        {photos.map((q, j) => (
          <button key={q.id} onClick={() => setI(j)} className={`size-14 overflow-hidden rounded-md border-2 ${j === i ? "border-white" : "border-transparent opacity-60 hover:opacity-100"}`}>
            <PhotoImg src={q.url} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <div className="mt-2 text-center text-xs text-white/60">
        {p.createdBy ? `Added by ${p.createdBy}, ` : ""}{new Date(p.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

export default function UnitPhotos({ unitId, editable = false }: { unitId: string; editable?: boolean }) {
  const { photos, setPhotos, canEdit, storage, reload } = usePhotos(unitId);
  const [open, setOpen] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const edit = editable && canEdit;
  const count = (photos?.length ?? 0) + pending.filter((p) => p.state !== "failed").length;

  const send = useCallback(
    async (file: File, key: string) => {
      const set = (patch: Partial<Pending>) => setPending((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
      try {
        set({ state: "preparing", message: undefined });
        const prepared = await preparePhoto(file);
        set({ state: "uploading" });
        const uploaded = await uploadPhoto(unitId, prepared, (attempt) => set({ state: "retrying", message: `No connection — retry ${attempt}` }));
        setPending((ps) => ps.filter((p) => p.key !== key));
        setPhotos((ps) => [...(ps ?? []), uploaded]);
      } catch (err) {
        set({ state: "failed", message: err instanceof PhotoError ? err.message : "Upload failed" });
      }
    },
    [unitId, setPhotos],
  );

  const add = (files: FileList | null) => {
    setError(null);
    if (!files?.length) return;
    const room = MAX - count;
    if (room <= 0) return setError(`At most ${MAX} photos per unit`);
    const chosen = [...files].slice(0, room);
    if (files.length > room) setError(`Only ${room} more fit — at most ${MAX} per unit`);
    for (const file of chosen) {
      const key = `${Date.now()}-${Math.random()}`;
      setPending((ps) => [...ps, { key, state: "preparing", file }]);
      void send(file, key);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/units/${unitId}/photos/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? "Could not remove the photo");
      return;
    }
    setPhotos((ps) => (ps ?? []).filter((p) => p.id !== id));
    reload();
  };

  if (photos === null) return null;
  if (!edit && photos.length === 0) return null;

  const tile = "relative size-16 shrink-0 overflow-hidden rounded-lg border border-line bg-page";
  return (
    <div className={edit ? "" : "mt-3"}>
      {edit && <div className="mb-1 text-xs font-medium text-muted">Nameplate photos ({photos.length}/{MAX})</div>}
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div key={p.id} className={tile}>
            <button onClick={() => setOpen(i)} className="size-full" title="Open">
              <PhotoImg src={p.url} alt="Nameplate" className="size-full object-cover" />
            </button>
            {edit && (
              <button title="Remove photo" onClick={() => void remove(p.id)} className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-ink/70 text-white hover:bg-alert">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.key} className={`${tile} flex flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] text-muted`} title={p.message}>
            {p.state === "failed" ? (
              <>
                <button onClick={() => void send(p.file, p.key)} title="Try again" className="text-alert"><RotateCw size={15} /></button>
                <span className="text-alert">Failed</span>
                <button onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))} className="underline">dismiss</button>
              </>
            ) : (
              <>
                <Loader2 size={15} className="animate-spin" />
                {p.state === "retrying" ? "Retrying" : p.state === "preparing" ? "Preparing" : "Uploading"}
              </>
            )}
          </div>
        ))}
        {edit && count < MAX && (
          <button onClick={() => input.current?.click()} disabled={storage === "off"} className={`${tile} flex flex-col items-center justify-center gap-1 border-dashed text-[10px] text-muted hover:text-ink disabled:opacity-50`} title={storage === "off" ? "Photo storage is not set up yet" : "Add photos from the gallery"}>
            <ImagePlus size={16} />
            Add photo
          </button>
        )}
      </div>
      {edit && (
        <input ref={input} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      )}
      {edit && storage === "off" && <p className="mt-1 text-xs text-muted">Photo storage is not set up on this server yet.</p>}
      {pending.some((p) => p.state === "failed") && <p className="mt-1 text-xs text-alert">{pending.find((p) => p.state === "failed")?.message}</p>}
      {error && <p className="mt-1 text-xs text-alert">{error}</p>}
      {open !== null && <Lightbox photos={photos} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
