"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { UNIT_IMAGE, UNIT_TYPE_LABEL, type LocationDetail, type UnitDetail, type PassportPatch } from "@/lib/api";
import { PassportEditButton, passportFields, passportLabel } from "./PassportEditor";
import { usePhotos, Lightbox, PhotoImg } from "./UnitPhotos";

/**
 * The unit's card, as in the client's mockup (3 Oct 2026): the nameplate photo large on the
 * left with the others as a strip beneath it and a "1 / 5" counter; on the right the nameplate
 * — Model, S/N, Year, Refrigerant — and, for an AC, the parts under a rule: Belts, Capacitor,
 * Filters. Empty fields show a grey "—", so what is missing is visible.
 *
 * Every field is one row in one style, label on the left and value on the right: a model such
 * as "48TCDD08A2A5A0A0A0" is a code to be copied, not prose, and a code that wraps or spills
 * over the card is useless. A value too long for the row is cut with an ellipsis, and the whole
 * of it is in the tooltip. Laid out against the card's own width, not the window's: the unit
 * panel is narrow beside the location list and wide on its own.
 */

function Field({ unit, f }: { unit: UnitDetail; f: keyof PassportPatch }) {
  const value = unit[f];
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm @2xl/card:text-base">
      <dt className="shrink-0 text-muted">{passportLabel(f)}</dt>
      <dd
        className={`min-w-0 truncate text-right font-medium tabular-nums ${value === null ? "text-faint" : "text-ink"}`}
        title={value === null ? undefined : String(value)}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function Gallery({ unit }: { unit: UnitDetail }) {
  const { photos } = usePhotos(unit.id);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const list = photos ?? [];
  const index = Math.min(current, Math.max(0, list.length - 1));
  const shown = list[index];

  return (
    <div className="min-w-0">
      <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-line-soft bg-page">
        {shown ? (
          <button onClick={() => setOpen(true)} className="block size-full" title="Open photo">
            <PhotoImg src={shown.url} alt={`${unit.name} nameplate`} className="size-full object-cover" />
          </button>
        ) : (
          // No photo yet: the drawing of the kind of unit it is, until someone takes one
          <img src={UNIT_IMAGE[unit.type]} alt={UNIT_TYPE_LABEL[unit.type]} className="size-full object-contain p-6 opacity-70" />
        )}
        {shown && (
          <button
            onClick={() => setOpen(true)}
            title="Enlarge"
            className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-md bg-ink/45 text-white backdrop-blur-sm transition-colors hover:bg-ink/65"
          >
            <Maximize2 size={15} />
          </button>
        )}
      </div>

      {list.length > 0 ? (
        <>
          <div className="mt-1 text-right text-xs text-muted tabular-nums">
            {index + 1} / {list.length}
          </div>
          <div className="mt-1.5 grid grid-cols-5 gap-1.5">
            {list.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setCurrent(i)}
                title={`Photo ${i + 1}`}
                className={`aspect-square overflow-hidden rounded-md border-2 transition-colors ${
                  i === index ? "border-accent" : "border-transparent opacity-80 hover:opacity-100"
                }`}
              >
                <PhotoImg src={p.url} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </>
      ) : (
        photos !== null && <div className="mt-1 text-xs text-faint">No nameplate photos yet</div>
      )}

      {open && list.length > 0 && <Lightbox photos={list} index={index} onClose={() => setOpen(false)} />}
    </div>
  );
}

export default function PassportCard({ unit, loc }: { unit: UnitDetail; loc: LocationDetail }) {
  const fields = passportFields(unit);
  const nameplate = fields.filter((f) => f === "model" || f === "serial" || f === "year" || f === "refrigerant");
  const parts = fields.filter((f) => f === "belts" || f === "capacitor" || f === "filter");

  return (
    <div className="@container/card mb-4 rounded-xl border border-line bg-panel p-4 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold @2xl/card:text-2xl">{unit.name}</h3>
          <div className="text-sm text-muted @2xl/card:text-base">
            {loc.name} · {UNIT_TYPE_LABEL[unit.type]}
          </div>
        </div>
        <PassportEditButton unit={unit} locationId={loc.id} />
      </div>

      <div className="grid gap-4 @md/card:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @2xl/card:gap-8">
        <Gallery unit={unit} />
        <div className="min-w-0">
          <dl className="space-y-2.5 @2xl/card:space-y-3">
            {nameplate.map((f) => <Field key={f} unit={unit} f={f} />)}
          </dl>
          {parts.length > 0 && (
            <dl className="mt-3 space-y-2.5 border-t border-line-soft pt-3 @2xl/card:mt-4 @2xl/card:space-y-3 @2xl/card:pt-4">
              {parts.map((f) => <Field key={f} unit={unit} f={f} />)}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
