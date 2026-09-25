"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Line, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { SwarmRole } from "../../../shared/swarm";
import {
  ROLE_HEX,
  ZERO_VEC,
  addVec,
  type SwarmVisualAgentNode,
  type SwarmVisualEdge,
  type SwarmVisualFloor,
  type SwarmVisualGraph,
  type SwarmVisualWorkNode,
  type Vec3,
} from "../../../shared/swarmVisual";

const CAMERA_POS: Vec3 = [14, 11, 14];
const CAMERA_TARGET: Vec3 = [0.3, 1.8, 0.4];
const ISO_OFFSET: Vec3 = [CAMERA_POS[0] - CAMERA_TARGET[0], CAMERA_POS[1] - CAMERA_TARGET[1], CAMERA_POS[2] - CAMERA_TARGET[2]];
const DEFAULT_ZOOM = 32;
const FOCUS_ZOOM = 118;

type ControlsApi = {
  enabled: boolean;
  target: THREE.Vector3;
};

export default function SwarmVisualizerScene({
  graph,
  selectedId,
  onSelect,
  floorOffsets,
  workOffset,
  onFloorOffset,
  onWorkOffset,
}: {
  graph: SwarmVisualGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  floorOffsets: Partial<Record<SwarmRole, Vec3>>;
  workOffset: Vec3;
  onFloorOffset: (role: SwarmRole, next: Vec3) => void;
  onWorkOffset: (next: Vec3) => void;
}) {
  const controls = useRef<ControlsApi | null>(null);
  const [focus, setFocus] = useState<{ target: Vec3; zoom: number; role?: string } | null>(null);

  const worldOf = (id: string): Vec3 | null => {
    const agent = graph.agents.find((a) => a.id === id);
    if (agent) return addVec(agent.position, floorOffsets[agent.role] ?? ZERO_VEC);
    const work = graph.work.find((w) => w.id === id);
    if (work) return addVec(work.position, workOffset);
    return null;
  };

  return (
    <Canvas
      orthographic
      camera={{ position: CAMERA_POS, zoom: 32, near: 0.1, far: 400 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => {
        onSelect(null);
        setFocus(null);
      }}
    >
      <color attach="background" args={["#0b0d12"]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#c9d6ea", "#12141a", 0.45]} />
      <directionalLight position={[10, 16, 8]} intensity={1.15} />
      <directionalLight position={[-8, 6, -6]} intensity={0.28} color="#8ec5ff" />
      <pointLight position={[0, 7, -3]} intensity={0.7} color="#f0c674" distance={24} />

      <gridHelper args={[80, 80, "#1a1e27", "#12151c"]} position={[0, -3.4, 1]} />

      {graph.floors.map((floor) => (
        <DraggablePlane
          key={floor.role}
          offset={floorOffsets[floor.role] ?? ZERO_VEC}
          onOffset={(next) => onFloorOffset(floor.role, next)}
          onActivate={() => {
            const target = addVec(floor.center, floorOffsets[floor.role] ?? ZERO_VEC);
            setFocus((prev) =>
              prev &&
              prev.role === floor.role &&
              Math.hypot(prev.target[0] - target[0], prev.target[1] - target[1], prev.target[2] - target[2]) < 0.35
                ? null
                : { target, zoom: FOCUS_ZOOM, role: floor.role },
            );
          }}
          controls={controls}
        >
          <RoleFloor floor={floor} focused={focus?.role === floor.role} />
          {graph.agents
            .filter((agent) => agent.role === floor.role)
            .map((agent) => (
              <AgentFigure
                key={agent.id}
                agent={agent}
                selected={selectedId === agent.id}
                dim={selectedId != null && selectedId !== agent.id}
                onSelect={() => onSelect(agent.id)}
              />
            ))}
        </DraggablePlane>
      ))}

      <DraggablePlane
        offset={workOffset}
        onOffset={onWorkOffset}
        onActivate={() => {
          const target = addVec([0, -2.42, 4.35], workOffset);
          setFocus({ target, zoom: 86, role: "work" });
        }}
        controls={controls}
      >
        {graph.work.length > 0 && <WorkBoard count={graph.work.length} />}
        {graph.work.map((node) => (
          <WorkChip key={node.id} node={node} active={selectedId === node.ownerAgentId} />
        ))}
      </DraggablePlane>

      {graph.edges.map((edge) => {
        const from = worldOf(edge.from);
        const to = worldOf(edge.to);
        if (!from || !to) return null;
        const fromAgent = graph.agents.find((a) => a.id === edge.from);
        const dim = selectedId != null && selectedId !== edge.from && selectedId !== edge.to;
        return (
          <StringCable
            key={edge.id}
            from={from}
            to={to}
            type={edge.type}
            color={edge.type === "spawn" ? "#f0c674" : ROLE_HEX[fromAgent?.role ?? "researcher"]}
            dim={dim}
            fromScale={fromAgent?.scale ?? 1}
          />
        );
      })}

      <CameraRig focus={focus} controls={controls} />
      <OrbitControls
        ref={controls as never}
        makeDefault
        enablePan
        enableZoom
        zoomSpeed={1.35}
        minZoom={4}
        maxZoom={280}
        maxPolarAngle={Math.PI / 2.05}
        target={CAMERA_TARGET}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}

function CameraRig({
  focus,
  controls,
}: {
  focus: { target: Vec3; zoom: number; role?: string } | null;
  controls: { current: ControlsApi | null };
}) {
  const { camera } = useThree();
  const last = useRef(focus);
  const goalTarget = useRef(new THREE.Vector3(...CAMERA_TARGET));
  const goalZoom = useRef(DEFAULT_ZOOM);
  const desired = useRef(new THREE.Vector3());
  const animating = useRef(false);

  if (last.current !== focus) {
    last.current = focus;
    const next = focus ?? { target: CAMERA_TARGET, zoom: DEFAULT_ZOOM };
    goalTarget.current.set(next.target[0], next.target[1], next.target[2]);
    goalZoom.current = next.zoom;
    animating.current = true;
  }

  useFrame((_, dt) => {
    if (!animating.current) return;
    if (controls.current) controls.current.enabled = false;
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = THREE.MathUtils.damp(cam.zoom, goalZoom.current, 18, dt);
    cam.updateProjectionMatrix();
    desired.current.set(
      goalTarget.current.x + ISO_OFFSET[0],
      goalTarget.current.y + ISO_OFFSET[1],
      goalTarget.current.z + ISO_OFFSET[2],
    );
    const k = 1 - Math.exp(-16 * dt);
    camera.position.lerp(desired.current, k);
    if (controls.current) controls.current.target.lerp(goalTarget.current, k);
    const settled =
      Math.abs(cam.zoom - goalZoom.current) < 0.2 && camera.position.distanceTo(desired.current) < 0.05;
    if (settled) {
      animating.current = false;
      if (controls.current) controls.current.enabled = true;
    }
  });
  return null;
}

function DraggablePlane({
  offset,
  onOffset,
  onActivate,
  controls,
  children,
}: {
  offset: Vec3;
  onOffset: (next: Vec3) => void;
  onActivate?: () => void;
  controls: { current: ControlsApi | null };
  children: ReactNode;
}) {
  const drag = useRef<{
    origin: THREE.Vector3;
    start: Vec3;
    plane: THREE.Plane;
    vertical: boolean;
    moved: boolean;
  } | null>(null);

  const begin = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const vertical = e.nativeEvent.shiftKey;
    const plane = new THREE.Plane();
    if (vertical) {
      const normal = new THREE.Vector3();
      e.camera.getWorldDirection(normal);
      normal.y = 0;
      if (normal.lengthSq() < 0.0001) normal.set(1, 0, 0);
      plane.setFromNormalAndCoplanarPoint(normal.normalize(), e.point);
    } else {
      plane.set(new THREE.Vector3(0, 1, 0), -e.point.y);
    }
    drag.current = { origin: e.point.clone(), start: offset, plane, vertical, moved: false };
    if (controls.current) controls.current.enabled = false;
    document.body.style.cursor = "grabbing";
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    e.stopPropagation();
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(drag.current.plane, hit)) return;
    const delta = hit.sub(drag.current.origin);
    if (delta.length() > 0.12) drag.current.moved = true;
    if (!drag.current.moved) return;
    if (drag.current.vertical) {
      onOffset([drag.current.start[0], drag.current.start[1] + delta.y, drag.current.start[2]]);
    } else {
      onOffset([drag.current.start[0] + delta.x, drag.current.start[1], drag.current.start[2] + delta.z]);
    }
  };

  const end = () => {
    if (!drag.current) return;
    const wasClick = !drag.current.moved;
    drag.current = null;
    if (controls.current) controls.current.enabled = true;
    document.body.style.cursor = "auto";
    if (wasClick) onActivate?.();
  };

  return (
    <group position={offset}>
      <group onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {children}
      </group>
    </group>
  );
}

function RoleFloor({ floor, focused }: { floor: SwarmVisualFloor; focused: boolean }) {
  const color = ROLE_HEX[floor.role];
  return (
    <group position={floor.center}>
      <mesh position={[0, -0.05, 0]} onPointerOver={() => (document.body.style.cursor = "grab")} onPointerOut={() => (document.body.style.cursor = "auto")}>
        <boxGeometry args={[floor.width, 0.08, floor.depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={focused ? 0.38 : 0.22}
          metalness={0.08}
          roughness={0.55}
          emissive={color}
          emissiveIntensity={focused ? 0.42 : 0.14}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <planeGeometry args={[floor.width, floor.depth]} />
        <meshStandardMaterial color={color} transparent opacity={0.16} roughness={0.75} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(floor.width, 0.08, floor.depth)]} />
        <lineBasicMaterial color={color} transparent opacity={focused ? 1 : 0.7} />
      </lineSegments>
      {focused && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[Math.min(floor.width, floor.depth) * 0.18, Math.min(floor.width, floor.depth) * 0.22, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} />
        </mesh>
      )}
      <Billboard position={[-floor.width / 2 + 0.12, 0.2, floor.depth / 2 + 0.02]}>
        <Text fontSize={0.16} color={color} anchorX="left" anchorY="middle">
          {floor.label.toUpperCase()}
        </Text>
      </Billboard>
    </group>
  );
}

function WorkBoard({ count }: { count: number }) {
  const cols = Math.min(4, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  const width = cols * 1.85 + 1.1;
  const depth = rows * 1.15 + 1.1;
  return (
    <group position={[0, -2.42, 4.35]}>
      <mesh onPointerOver={() => (document.body.style.cursor = "grab")} onPointerOut={() => (document.body.style.cursor = "auto")}>
        <boxGeometry args={[width, 0.08, depth]} />
        <meshStandardMaterial color="#9aa4b5" transparent opacity={0.16} roughness={0.7} />
      </mesh>
      <Billboard position={[-width / 2 + 0.12, 0.2, depth / 2]}>
        <Text fontSize={0.15} color="#9aa4b5" anchorX="left" anchorY="middle">
          SHARED BOARD
        </Text>
      </Billboard>
    </group>
  );
}

function StringCable({
  from,
  to,
  type,
  color,
  dim,
  fromScale,
}: {
  from: Vec3;
  to: Vec3;
  type: SwarmVisualEdge["type"];
  color: string;
  dim: boolean;
  fromScale: number;
}) {
  const points = useMemo(() => {
    const start = new THREE.Vector3(from[0], from[1] + 0.86 * fromScale, from[2]);
    const end = new THREE.Vector3(to[0], to[1] + (type === "work" ? 0.22 : 0.78), to[2]);
    const lift = Math.min(2.4, 0.35 + start.distanceTo(end) * 0.12);
    const mid = new THREE.Vector3((start.x + end.x) / 2, Math.max(start.y, end.y) + lift, (start.z + end.z) / 2);
    return new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(20);
  }, [from, to, type, fromScale]);

  return (
    <Line
      points={points}
      color={color}
      lineWidth={type === "spawn" ? 1.7 : 1.15}
      transparent
      opacity={dim ? 0.14 : type === "spawn" ? 0.82 : 0.58}
      dashed={type === "work"}
      dashSize={0.12}
      gapSize={0.08}
    />
  );
}

function WorkChip({ node, active }: { node: SwarmVisualWorkNode; active: boolean }) {
  return (
    <group position={node.position}>
      <mesh>
        <boxGeometry args={[1.5, 0.14, 0.64]} />
        <meshStandardMaterial
          color={active ? "#8ec5ff" : "#9aa4b5"}
          emissive={active ? "#8ec5ff" : "#9aa4b5"}
          emissiveIntensity={active ? 0.3 : 0.06}
          transparent
          opacity={active ? 0.45 : 0.22}
        />
      </mesh>
      <Billboard position={[0, 0.32, 0]}>
        <Text fontSize={0.12} color="#f0f0f0" anchorX="center" anchorY="bottom" maxWidth={1.45}>
          {node.title}
        </Text>
        <Text fontSize={0.09} color="#9aa4b5" anchorX="center" anchorY="top" position={[0, -0.02, 0]}>
          {node.status}
        </Text>
      </Billboard>
    </group>
  );
}

function AgentFigure({
  agent,
  selected,
  dim,
  onSelect,
}: {
  agent: SwarmVisualAgentNode;
  selected: boolean;
  dim: boolean;
  onSelect: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const appear = useRef(0);
  const color = ROLE_HEX[agent.role];
  const dead = agent.visualStatus === "dead" || agent.visualStatus === "error";
  const working = agent.visualStatus === "working";
  const opacity = dim ? 0.32 : dead ? 0.48 : 1;
  const scale = agent.scale;

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    appear.current = Math.min(1, appear.current + dt * 4.2);
    const enter = 1 - (1 - appear.current) ** 3;
    if (group.current) {
      group.current.position.y = agent.position[1] + (working ? Math.sin(t * 2.4) * 0.035 : 0) + (1 - enter) * 0.45;
      group.current.scale.setScalar(scale * (0.2 + 0.8 * enter));
      if (working) group.current.rotation.y = Math.sin(t * 1.1) * 0.08;
    }
    if (glow.current) {
      const mat = glow.current.material as THREE.MeshStandardMaterial;
      mat.opacity = (working ? 0.2 + Math.sin(t * 3.2) * 0.07 : 0.04) * enter;
    }
  });

  return (
    <group
      ref={group}
      position={agent.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <mesh ref={glow} position={[0, 0.52, 0]}>
        <sphereGeometry args={[0.62, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={working ? 0.9 : 0.12}
          transparent
          opacity={0.07}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.22, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.32} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.028, 0]}>
          <ringGeometry args={[0.28, 0.36, 28]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} />
        </mesh>
      )}
      <mesh position={[-0.065, 0.2, 0]}>
        <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0.065, 0.2, 0]}>
        <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <capsuleGeometry args={[0.125, 0.26, 6, 12]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[-0.2, working ? 0.66 : 0.52, 0]} rotation={[0, 0, working ? 0.9 : 0.36]}>
        <capsuleGeometry args={[0.028, 0.22, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0.2, 0.52, 0]} rotation={[0, 0, -0.36]}>
        <capsuleGeometry args={[0.028, 0.22, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0, 0.84, 0]}>
        <sphereGeometry args={[0.125, 18, 18]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[-0.04, 0.86, 0.1]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>
      <mesh position={[0.04, 0.86, 0.1]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>
      <mesh position={[0, 1.02, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0, 1.12, 0]}>
        <sphereGeometry args={[0.038, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={working ? 1.5 : 0.35} transparent opacity={opacity} />
      </mesh>
      {agent.role === "orchestrator" && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.96, 0]}>
          <torusGeometry args={[0.28, 0.016, 10, 28]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
        </mesh>
      )}
      {agent.visualStatus === "error" && (
        <mesh position={[0.16, 0.96, 0.08]} rotation={[0, 0, -0.7]}>
          <boxGeometry args={[0.26, 0.025, 0.025]} />
          <meshStandardMaterial color="#f07070" emissive="#f07070" emissiveIntensity={0.85} />
        </mesh>
      )}
      <Billboard position={[0, dead ? 1.26 : 1.42, 0]}>
        <Text fontSize={0.15} color={dim ? "#8a8a8a" : "#f2f2f2"} anchorX="center" anchorY="bottom">
          @{agent.label}
        </Text>
        <Text fontSize={0.11} color={color} anchorX="center" anchorY="top" position={[0, -0.02, 0]}>
          {agent.visualStatus}
        </Text>
      </Billboard>
    </group>
  );
}

function BodyMaterial({
  color,
  opacity,
  working,
}: {
  color: string;
  opacity: number;
  working: boolean;
}) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={working ? 0.5 : 0.16}
      metalness={0.16}
      roughness={0.42}
      transparent
      opacity={opacity}
    />
  );
}
