import { useState } from 'react';
import type { OverlayModel } from './overlay';
import type { RegionId } from './regions';

export interface BodyMapViewProps {
  selected: RegionId;
  onSelect: (id: RegionId) => void;
  overlay: OverlayModel | null;
}

const BASE = '#2a4068';
const HOVER = '#3d5683';
const SELECTED = '#16a2ba';

/** Shapes in a 200 x 420 box. The figure faces you, so its left side is drawn on the right. */
const SHAPES: Array<{
  id: Exclude<RegionId, 'whole_body'>;
  el: 'circle' | 'rect';
  attrs: Record<string, number>;
}> = [
  { id: 'head', el: 'circle', attrs: { cx: 100, cy: 42, r: 28 } },
  { id: 'chest', el: 'rect', attrs: { x: 64, y: 78, width: 72, height: 92, rx: 18 } },
  { id: 'abdomen', el: 'rect', attrs: { x: 70, y: 174, width: 60, height: 60, rx: 14 } },
  { id: 'right_arm', el: 'rect', attrs: { x: 36, y: 84, width: 22, height: 150, rx: 11 } },
  { id: 'left_arm', el: 'rect', attrs: { x: 142, y: 84, width: 22, height: 150, rx: 11 } },
  { id: 'right_leg', el: 'rect', attrs: { x: 70, y: 238, width: 28, height: 172, rx: 14 } },
  { id: 'left_leg', el: 'rect', attrs: { x: 102, y: 238, width: 28, height: 172, rx: 14 } },
];

/**
 * 2D fallback. Pointer users click shapes; keyboard and screen reader users use the
 * region list beside it, so the drawing itself is hidden from assistive tech.
 */
export function BodyMap2D({ selected, onSelect, overlay }: BodyMapViewProps) {
  const [hover, setHover] = useState<RegionId | null>(null);
  const wholeSelected = selected === 'whole_body';

  return (
    <svg
      viewBox="0 0 200 420"
      className="mx-auto h-[26rem] max-h-[60vh] w-auto"
      aria-hidden="true"
      data-testid="body-map-2d"
    >
      <rect
        x="28"
        y="6"
        width="144"
        height="410"
        rx="24"
        fill="none"
        stroke={wholeSelected ? SELECTED : '#22355a'}
        strokeWidth={wholeSelected ? 3 : 1}
        strokeDasharray={wholeSelected ? undefined : '0'}
        onClick={() => onSelect('whole_body')}
        data-region="whole_body"
        className="cursor-pointer"
      />
      {SHAPES.map(({ id, el, attrs }) => {
        const fill = overlay
          ? overlay.regions[id].color
          : selected === id
            ? SELECTED
            : hover === id
              ? HOVER
              : BASE;
        const common = {
          fill,
          stroke: selected === id ? '#e6edf7' : hover === id ? '#a4b3cc' : '#0e1a30',
          strokeWidth: selected === id ? 3 : 2,
          onClick: () => onSelect(id),
          onPointerEnter: () => setHover(id),
          onPointerLeave: () => setHover(null),
          className: 'cursor-pointer transition-colors',
          'data-region': id,
          'data-selected': selected === id,
        };
        return el === 'circle' ? (
          <circle key={id} {...attrs} {...common} />
        ) : (
          <rect key={id} {...attrs} {...common} />
        );
      })}
    </svg>
  );
}
