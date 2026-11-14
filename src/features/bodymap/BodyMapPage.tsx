import { lazy, Suspense, useState } from 'react';
import { DataState, PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAstronautContext } from '@/features/health/hooks';
import { BodyMap2D } from './BodyMap2D';
import { hasWebGL, prefersReducedMotion } from './capabilities';
import { useOrganDose } from './hooks';
import { buildOverlay } from './overlay';
import { OverlayLegend } from './OverlayLegend';
import { RegionList } from './RegionList';
import { RegionPanel } from './RegionPanel';
import type { RegionId } from './regions';

// The Three.js bundle is fetched only when the 3D view is shown.
const BodyMap3D = lazy(() => import('./BodyMap3D'));

type View = '3d' | '2d';

function autoView(): { view: View; reason: string | null; webgl: boolean } {
  const webgl = hasWebGL();
  if (!webgl)
    return {
      view: '2d',
      reason: '3D view unavailable: this browser does not support WebGL.',
      webgl,
    };
  if (prefersReducedMotion()) {
    return {
      view: '2d',
      reason: 'Showing the 2D view because reduced motion is requested.',
      webgl,
    };
  }
  return { view: '3d', reason: null, webgl };
}

export function BodyMapPage() {
  const [initial] = useState(autoView);
  const [view, setView] = useState<View>(initial.view);
  const [region, setRegion] = useState<RegionId>('whole_body');
  const [overlayOn, setOverlayOn] = useState(false);

  const { astronautId, missionTime } = useAstronautContext();
  const organDose = useOrganDose(astronautId, missionTime);
  const overlay = organDose.data && missionTime ? buildOverlay(organDose.data, missionTime) : null;
  const shownOverlay = overlayOn ? overlay : null;

  const viewProps = { selected: region, onSelect: setRegion, overlay: shownOverlay };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Body Map"
        description="Select a body region to see its measurements."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="View" className="flex gap-1 rounded-md border p-1">
              {(['3d', '2d'] as const).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  role="radio"
                  aria-checked={view === v}
                  variant={view === v ? 'default' : 'ghost'}
                  disabled={v === '3d' && !initial.webgl}
                  onClick={() => setView(v)}
                >
                  {v === '3d' ? '3D' : '2D'}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant={overlayOn ? 'default' : 'outline'}
              aria-pressed={overlayOn}
              onClick={() => setOverlayOn((o) => !o)}
            >
              Radiation overlay
            </Button>
          </div>
        }
      />

      {initial.reason && view === '2d' && (
        <p role="status" className="text-sm text-ink-muted">
          {initial.reason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_minmax(0,22rem)]">
        <Card className="p-3">
          <RegionList selected={region} onSelect={setRegion} />
        </Card>

        <Card className="space-y-3 p-4">
          {view === '3d' ? (
            <Suspense fallback={<DataState status="loading" loadingMessage="Loading 3D view…" />}>
              <BodyMap3D {...viewProps} />
            </Suspense>
          ) : (
            <BodyMap2D {...viewProps} />
          )}
          {view === '3d' && (
            <p className="text-caption text-ink-subtle">
              Drag to rotate, scroll to zoom. Click a region to select it.
            </p>
          )}
          {overlayOn && (
            <DataState
              status={
                organDose.isPending
                  ? 'loading'
                  : organDose.isError
                    ? 'error'
                    : overlay && overlay.max > 0
                      ? 'ready'
                      : 'no-data'
              }
              error={organDose.error}
              noDataMessage="No data: no modelled dose estimate exists yet."
            >
              {overlay && <OverlayLegend overlay={overlay} />}
            </DataState>
          )}
        </Card>

        <RegionPanel region={region} overlay={overlay} />
      </div>
    </div>
  );
}
