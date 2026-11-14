/**
 * Procedural 3D body (spheres and capsules only, so no model licence is needed).
 * Loaded lazily; the region list stays the accessible control.
 */
import { OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import type { BodyMapViewProps } from './BodyMap2D';
import type { RegionId } from './regions';

type Part = Exclude<RegionId, 'whole_body'>;

interface MeshSpec {
  id: Part;
  shape: 'sphere' | 'capsule';
  args: [number, number?];
  position: [number, number, number];
  rotationZ?: number;
}

// The figure faces the camera: its left side is at +x (your right).
const MESHES: MeshSpec[] = [
  { id: 'head', shape: 'sphere', args: [0.27], position: [0, 1.72, 0] },
  { id: 'chest', shape: 'capsule', args: [0.32, 0.34], position: [0, 1.08, 0] },
  { id: 'abdomen', shape: 'capsule', args: [0.27, 0.16], position: [0, 0.56, 0] },
  {
    id: 'left_arm',
    shape: 'capsule',
    args: [0.09, 0.72],
    position: [0.52, 0.98, 0],
    rotationZ: 0.14,
  },
  {
    id: 'right_arm',
    shape: 'capsule',
    args: [0.09, 0.72],
    position: [-0.52, 0.98, 0],
    rotationZ: -0.14,
  },
  { id: 'left_leg', shape: 'capsule', args: [0.12, 0.86], position: [0.17, -0.3, 0] },
  { id: 'right_leg', shape: 'capsule', args: [0.12, 0.86], position: [-0.17, -0.3, 0] },
];

const BASE = '#2a4068';
const HOVER = '#3d5683';
const SELECTED = '#16a2ba';

export default function BodyMap3D({ selected, onSelect, overlay }: BodyMapViewProps) {
  const [hover, setHover] = useState<Part | null>(null);

  const colorFor = (id: Part) => {
    if (overlay) return overlay.regions[id].color;
    if (selected === id || selected === 'whole_body') return SELECTED;
    return hover === id ? HOVER : BASE;
  };

  const handlers = (id: Part) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onSelect(id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(id);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHover(null);
      document.body.style.cursor = '';
    },
  });

  return (
    <div className="h-[26rem] max-h-[60vh] w-full" aria-hidden="true" data-testid="body-map-3d">
      <Canvas camera={{ position: [0, 0.8, 4.4], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#0a1324']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-3, 2, -3]} intensity={0.35} />
        <group position={[0, -0.6, 0]}>
          {MESHES.map((m) => (
            <mesh
              key={m.id}
              position={m.position}
              rotation={[0, 0, m.rotationZ ?? 0]}
              {...handlers(m.id)}
            >
              {m.shape === 'sphere' ? (
                <sphereGeometry args={[m.args[0], 32, 32]} />
              ) : (
                <capsuleGeometry args={[m.args[0], m.args[1] ?? 0.5, 8, 24]} />
              )}
              <meshStandardMaterial
                color={colorFor(m.id)}
                emissive={selected === m.id ? SELECTED : '#000000'}
                emissiveIntensity={selected === m.id ? 0.35 : 0}
                roughness={0.55}
                metalness={0.1}
              />
            </mesh>
          ))}
        </group>
        <OrbitControls enablePan={false} minDistance={3} maxDistance={7} target={[0, 0.5, 0]} />
      </Canvas>
    </div>
  );
}
