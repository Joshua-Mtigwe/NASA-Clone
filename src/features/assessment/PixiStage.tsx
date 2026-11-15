/**
 * PixiJS rendering of Mission Mind games in a spacecraft-operations style.
 * Loaded lazily. It only draws the engine's current state: when a stimulus is
 * visible and what it is. It never schedules anything, so the theme cannot change
 * stimulus timing or difficulty.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef } from 'react';
import type { EngineState } from './engine/types';
import { INK_HEX } from './battery/core';
import { parseRotation, ROTATION_SHAPE, type SwitchRule } from './battery/extended';

const CYAN = 0x22c3dd;
const DIM = 0x1c2e4f;
const INKC = 0xe6edf7;
const VIOLET = 0x9a82f4;

function drawShape(
  layer: Container,
  x: number,
  y: number,
  size: number,
  angle: number,
  mirrored: boolean,
) {
  const g = new Graphics();
  const cell = size / 4;
  for (const [cx, cy] of ROTATION_SHAPE) {
    g.roundRect(cx * cell - 2 * cell, cy * cell - 2 * cell, cell * 0.92, cell * 0.92, 3).fill(CYAN);
  }
  g.position.set(x, y);
  g.scale.x = mirrored ? -1 : 1;
  g.rotation = (angle * Math.PI) / 180;
  layer.addChild(g);
}

function label(text: string, size: number, color: number, x: number, y: number, mono = true) {
  const t = new Text({
    text,
    style: {
      fill: color,
      fontSize: size,
      fontFamily: mono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif',
      fontWeight: '700',
    },
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
}

function draw(
  app: Application,
  layer: Container,
  protocolId: string,
  state: EngineState,
  title: string,
) {
  for (const child of layer.removeChildren()) child.destroy();
  const w = app.screen.width;
  const h = app.screen.height;
  const cx = w / 2;
  const cy = h / 2;

  // Static backdrop: fixed star positions, redrawn identically every frame.
  const stars = new Graphics();
  for (let i = 0; i < 70; i += 1) {
    const sx = ((i * 7919) % 1000) / 1000;
    const sy = ((i * 104729) % 1000) / 1000;
    stars.circle(16 + sx * (w - 32), 16 + sy * (h - 32), i % 9 === 0 ? 1.4 : 0.8);
  }
  stars.fill({ color: INKC, alpha: 0.35 });
  layer.addChild(stars);

  const frame = new Graphics()
    .roundRect(8, 8, w - 16, h - 16, 14)
    .stroke({ width: 2, color: CYAN, alpha: 0.35 });
  frame.roundRect(14, 14, w - 28, h - 28, 10).stroke({ width: 1, color: VIOLET, alpha: 0.2 });
  layer.addChild(frame);
  layer.addChild(label(`${title.toUpperCase()} · CONSOLE`, 12, CYAN, cx, 24));

  const spec = state.spec;
  const visible = state.stimulusVisible && spec;

  switch (protocolId) {
    case 'PVT': {
      const light = new Graphics().circle(cx, cy, 48).fill(visible ? CYAN : DIM);
      if (visible) light.circle(cx, cy, 70).stroke({ width: 3, color: CYAN, alpha: 0.4 });
      layer.addChild(light);
      break;
    }
    case 'NBACK': {
      const grid = new Graphics();
      for (let i = 0; i < 3; i += 1)
        for (let j = 0; j < 3; j += 1)
          grid
            .roundRect(cx - 75 + i * 52, cy - 75 + j * 52, 46, 46, 6)
            .stroke({ width: 1, color: CYAN, alpha: 0.3 });
      layer.addChild(grid);
      if (visible) layer.addChild(label(String(spec.display.letter), 40, INKC, cx, cy));
      break;
    }
    case 'STROOP': {
      layer.addChild(new Graphics().rect(40, cy + 40, w - 80, 2).fill({ color: CYAN, alpha: 0.4 }));
      if (visible) {
        const ink = INK_HEX[spec.display.ink as keyof typeof INK_HEX] ?? INKC;
        layer.addChild(label(String(spec.display.word), 56, ink, cx, cy, false));
      }
      break;
    }
    case 'ROTATION': {
      if (visible) {
        const { angle, mirrored } = parseRotation(spec.stimulus_value);
        drawShape(layer, cx - 90, cy, 110, 0, false);
        drawShape(layer, cx + 90, cy, 110, angle, mirrored);
      } else layer.addChild(label('+', 28, DIM, cx, cy));
      break;
    }
    case 'SWITCH': {
      if (visible) {
        const rule = spec.display.rule as SwitchRule;
        layer.addChild(
          label(rule === 'parity' ? 'ODD ◀  ▶ EVEN' : 'LOW ◀  ▶ HIGH', 16, CYAN, cx, cy - 60),
        );
        layer.addChild(label(String(spec.display.digit), 64, INKC, cx, cy + 10));
      } else layer.addChild(label('+', 28, DIM, cx, cy));
      break;
    }
    default:
      layer.addChild(label('+', 28, DIM, cx, cy));
  }
}

export default function PixiStage({
  protocolId,
  state,
  title,
}: {
  protocolId: string;
  state: EngineState;
  title: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const app = useRef<Application | null>(null);
  const layer = useRef<Container | null>(null);
  const latest = useRef({ protocolId, state, title });
  latest.current = { protocolId, state, title };

  useEffect(() => {
    let cancelled = false;
    const instance = new Application();
    void instance
      .init({ resizeTo: host.current!, background: '#050a14', antialias: true, autoDensity: true })
      .then(() => {
        if (cancelled) {
          instance.destroy(true);
          return;
        }
        host.current!.appendChild(instance.canvas);
        const root = new Container();
        instance.stage.addChild(root);
        app.current = instance;
        layer.current = root;
        const { protocolId: p, state: s, title: t } = latest.current;
        draw(instance, root, p, s, t);
      });
    return () => {
      cancelled = true;
      app.current?.destroy(true, { children: true });
      app.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    if (app.current && layer.current) draw(app.current, layer.current, protocolId, state, title);
  }, [protocolId, state, title]);

  return (
    <div
      ref={host}
      className="h-64 w-full overflow-hidden rounded-lg"
      aria-hidden="true"
      data-testid="pixi-stage"
    />
  );
}
