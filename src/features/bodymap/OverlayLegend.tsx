import { formatDate, formatNumber } from '@/lib/format';
import type { OverlayModel } from './overlay';
import { DOSE_RAMP, NO_ESTIMATE_COLOR } from './regions';

/** Legend for the radiation overlay: scale, units and the "Modelled estimate" label. */
export function OverlayLegend({ overlay }: { overlay: OverlayModel }) {
  const whole = overlay.regions.whole_body.estimate;
  return (
    <section
      aria-labelledby="overlay-legend-title"
      className="space-y-2 rounded-md border p-3 text-caption"
      data-testid="overlay-legend"
    >
      <h3
        id="overlay-legend-title"
        className="flex flex-wrap items-center gap-2 text-label font-medium text-ink"
      >
        Radiation overlay
        <span className="rounded border border-status-review/50 px-1.5 py-0.5 text-caption text-status-review">
          Modelled estimate
        </span>
      </h3>
      <p className="text-ink-muted">
        Colours show the modelled organ dose from the backend, not a direct measurement.
        {!overlay.hasRegional &&
          ' No regional estimates exist, so every region shows the whole-body estimate.'}
      </p>
      <div>
        <div className="flex h-3 overflow-hidden rounded-sm" aria-hidden="true">
          {DOSE_RAMP.map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-ink-muted">
          <span>0 {overlay.unit ?? ''}</span>
          <span>
            {formatNumber(overlay.max, 4)} {overlay.unit ?? ''}
          </span>
        </div>
        <p className="sr-only">
          Scale from 0 to {formatNumber(overlay.max, 4)} {overlay.unit ?? ''}, dim to bright.
        </p>
      </div>
      <p className="flex items-center gap-2 text-ink-muted">
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ background: NO_ESTIMATE_COLOR }}
          aria-hidden="true"
        />
        No estimate available
      </p>
      {whole && (
        <p className="text-ink-subtle">
          Model {whole.model_name} {whole.model_version} · {formatDate(whole.timestamp_utc)} ·
          uncertainty: {whole.uncertainty.replace(/_/g, ' ')}
        </p>
      )}
    </section>
  );
}
