"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  ROLE_HEX,
  type SwarmVisualAgentNode,
  type SwarmVisualEdge,
  type SwarmVisualFloor,
  type SwarmVisualGraph,
  type SwarmVisualWorkNode,
  type Vec3,
} from "../../../shared/swarmVisual";

export default function SwarmVisualizerScene({
  graph,
  selectedId,
  onSelect,
}: {
  graph: SwarmVisualGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, Vec3>();
    for (const node of graph.agents) map.set(node.id, node.position);
    for (const node of graph.work) map.set(node.id, node.position);
    return map;
  }, [graph]);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: "#0b0d12" }}
    >
      <color attach="background" args={["#0b0d12"]} />
      <fog attach="fog" args={["#0b0d12", 22, 48]} />
      <OrthographicCamera makeDefault position={[16, 13, 16]} zoom={38} near={-80} far={80} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[10, 16, 8]} intensity={1.15} />
      <directionalLight position={[-8, 6, -6]} intensity={0.28} color="#8ec5ff" />
      <pointLight position={[0, 7.2, -3]} intensity={0.7} color="#f0c674" distance={18} />

      <gridHelper args={[28, 28, "#1b1e26", "#14171d"]} position={[0, -2.7, 0]} />

      {graph.floors.map((floor) => (
        <RoleFloor key={floor.role} floor={floor} />
      ))}
      {graph.work.length > 0 && <WorkBoard count={graph.work.length} />}

      {graph.edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const fromAgent = graph.agents.find((a) => a.id === edge.from);
        const dim =
          selectedId != null && selectedId !== edge.from && selectedId !== edge.to;
        return (
          <CurveEdge
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

      {graph.work.map((node) => (
        <WorkChip key={node.id} node={node} active={selectedId === node.ownerAgentId} />
      ))}

      {graph.agents.map((agent) => (
        <AgentFigure
          key={agent.id}
          agent={agent}
          selected={selectedId === agent.id}
          dim={selectedId != null && selectedId !== agent.id}
          onSelect={() => onSelect(agent.id)}
        />
      ))}

      <OrbitControls
        makeDefault
        enablePan
        minZoom={22}
        maxZoom={70}
        maxPolarAngle={Math.PI / 2.15}
        target={[0.4, 1.4, 0.6]}
      />
    </Canvas>
  );
}

function RoleFloor({ floor }: { floor: SwarmVisualFloor }) {
  const color = ROLE_HEX[floor.role];
  const edgeGeo = useMemo(
    () => new THREE.BoxGeometry(floor.width, 0.1, floor.depth),
    [floor.width, floor.depth],
  );
  return (
    <group position={floor.center}>
      <mesh position={[0, -0.07, 0]} castShadow={false}>
        <boxGeometry args={[floor.width, 0.1, floor.depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.16}
          metalness={0.15}
          roughness={0.55}
          emissive={color}
          emissiveIntensity={0.08}
        />
      </mesh>
      <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[floor.width, floor.depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.22}
          metalness={0.05}
          roughness={0.7}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[edgeGeo]} />
        <lineBasicMaterial color={color} transparent opacity={0.55} />
      </lineSegments>
      <Html position={[-floor.width / 2 + 0.15, 0.12, floor.depth / 2 + 0.05]} center={false} distanceFactor={10}>
        <div className="whitespace-nowrap text-[10px] font-medium tracking-wide" style={{ color }}>
          {floor.label.toUpperCase()}
        </div>
      </Html>
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
      <mesh>
        <boxGeometry args={[width, 0.08, depth]} />
        <meshStandardMaterial color="#9aa4b5" transparent opacity={0.12} roughness={0.7} />
      </mesh>
      <Html position={[-width / 2 + 0.2, 0.12, depth / 2 + 0.04]} distanceFactor={10}>
        <div className="whitespace-nowrap text-[10px] font-medium tracking-wide text-[#9aa4b5]">
          SHARED BOARD
        </div>
      </Html>
    </group>
  );
}

function CurveEdge({
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
  const start = useMemo(
    () => new THREE.Vector3(from[0], from[1] + 0.78 * fromScale, from[2]),
    [from, fromScale],
  );
  const end = useMemo(
    () => new THREE.Vector3(to[0], to[1] + (type === "work" ? 0.22 : 0.72), to[2]),
    [to, type],
  );
  const mid = useMemo(() => {
    const lift = type === "spawn" ? 1.15 : 0.55;
    return new THREE.Vector3(
      (start.x + end.x) / 2,
      Math.max(start.y, end.y) + lift,
      (start.z + end.z) / 2,
    );
  }, [start, end, type]);
  const geometry = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    return new THREE.TubeGeometry(curve, 24, type === "spawn" ? 0.018 : 0.012, 6, false);
  }, [start, mid, end, type]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={dim ? 0.05 : type === "spawn" ? 0.35 : 0.22}
        transparent
        opacity={dim ? 0.12 : type === "spawn" ? 0.7 : 0.55}
        depthWrite={false}
      />
    </mesh>
  );
}

function WorkChip({ node, active }: { node: SwarmVisualWorkNode; active: boolean }) {
  const color = "#9aa4b5";
  return (
    <group position={node.position}>
      <mesh>
        <boxGeometry args={[1.55, 0.16, 0.72]} />
        <meshStandardMaterial
          color={color}
          emissive={active ? "#8ec5ff" : color}
          emissiveIntensity={active ? 0.25 : 0.04}
          transparent
          opacity={active ? 0.35 : 0.18}
        />
      </mesh>
      <Html position={[0, 0.22, 0]} center distanceFactor={8}>
        <div className="max-w-[120px] rounded-md border border-[#2b2b2b] bg-[#161616]/90 px-1.5 py-1 text-center">
          <p className="truncate text-[10px] text-[#e4e4e4]">{node.title}</p>
          <p className="text-[9px] text-[#6e6e6e]">{node.status}</p>
        </div>
      </Html>
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
  const antenna = useRef<THREE.Mesh>(null);
  const color = ROLE_HEX[agent.role];
  const dead = agent.visualStatus === "dead" || agent.visualStatus === "error";
  const working = agent.visualStatus === "working";
  const opacity = dim ? 0.28 : dead ? 0.42 : 1;
  const scale = agent.scale;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.position.y = agent.position[1] + (working ? Math.sin(t * 2.4) * 0.045 : 0);
      if (working) group.current.rotation.y = Math.sin(t * 1.1) * 0.12;
    }
    if (glow.current) {
      const mat = glow.current.material as THREE.MeshStandardMaterial;
      mat.opacity = working ? 0.18 + Math.sin(t * 3.2) * 0.08 : 0.02;
    }
    if (antenna.current && working) {
      antenna.current.position.y = 1.1 + Math.sin(t * 6) * 0.02;
    }
  });

  return (
    <group
      ref={group}
      position={agent.position}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <mesh ref={glow} position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.72, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={working ? 0.8 : 0.05}
          transparent
          opacity={0.04}
          depthWrite={false}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.24, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} />
      </mesh>

      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.3, 0.36, 28]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} />
        </mesh>
      )}

      <mesh position={[-0.07, 0.2, 0]}>
        <capsuleGeometry args={[0.035, 0.22, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0.07, 0.2, 0]}>
        <capsuleGeometry args={[0.035, 0.22, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>

      <mesh position={[0, 0.52, 0]}>
        <capsuleGeometry args={[0.13, 0.28, 6, 12]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>

      <mesh
        position={[-0.2, working ? 0.68 : 0.52, 0]}
        rotation={[0, 0, working ? 0.9 : 0.35]}
      >
        <capsuleGeometry args={[0.03, 0.24, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0.2, 0.52, 0]} rotation={[0, 0, -0.35]}>
        <capsuleGeometry args={[0.03, 0.24, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>

      <mesh position={[0, 0.84, 0]}>
        <sphereGeometry args={[0.13, 18, 18]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[-0.045, 0.86, 0.1]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>
      <mesh position={[0.045, 0.86, 0.1]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>

      <mesh position={[0, 1.02, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh ref={antenna} position={[0, 1.12, 0]}>
        <sphereGeometry args={[0.04, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={working ? 1.4 : 0.25}
          transparent
          opacity={opacity}
        />
      </mesh>

      {agent.role === "orchestrator" && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.95, 0]}>
          <torusGeometry args={[0.28, 0.018, 10, 28]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} transparent opacity={0.85} />
        </mesh>
      )}

      {agent.visualStatus === "error" && (
        <mesh position={[0.16, 0.95, 0.08]} rotation={[0, 0, -0.7]}>
          <boxGeometry args={[0.28, 0.025, 0.025]} />
          <meshStandardMaterial color="#f07070" emissive="#f07070" emissiveIntensity={0.8} />
        </mesh>
      )}

      <Html position={[0, dead ? 1.25 : 1.42, 0]} center distanceFactor={7} occlude={false}>
        <div className={`text-center ${dim ? "opacity-40" : ""}`}>
          <div className="whitespace-nowrap text-[11px] font-medium text-[#e8e8e8]">@{agent.label}</div>
          <div className="text-[10px]" style={{ color }}>
            {agent.visualStatus}
          </div>
        </div>
      </Html>
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
      emissiveIntensity={working ? 0.45 : 0.12}
      metalness={0.22}
      roughness={0.42}
      transparent
      opacity={opacity}
    />
  );
}
