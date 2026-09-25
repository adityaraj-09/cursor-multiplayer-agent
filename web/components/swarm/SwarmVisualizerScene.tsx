"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, OrbitControls, Text } from "@react-three/drei";
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

const CAMERA_POS: Vec3 = [11, 9, 11];
const CAMERA_TARGET: Vec3 = [0.2, 1.6, 0.5];

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
      orthographic
      camera={{ position: CAMERA_POS, zoom: 26, near: 0.1, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#10131a"]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#d7e3f5", "#1b1c20", 0.55]} />
      <directionalLight position={[8, 14, 6]} intensity={1.35} />
      <directionalLight position={[-6, 5, -4]} intensity={0.4} color="#8ec5ff" />
      <pointLight position={[0, 6.5, -2.5]} intensity={0.9} color="#f0c674" distance={22} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.75, 0.6]}>
        <planeGeometry args={[26, 22]} />
        <meshStandardMaterial color="#151821" roughness={1} />
      </mesh>
      <gridHelper args={[26, 26, "#2a3040", "#1c202a"]} position={[0, -2.74, 0.6]} />

      {graph.floors.map((floor) => (
        <RoleFloor key={floor.role} floor={floor} />
      ))}
      {graph.work.length > 0 && <WorkBoard count={graph.work.length} />}

      {graph.edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const fromAgent = graph.agents.find((a) => a.id === edge.from);
        const dim = selectedId != null && selectedId !== edge.from && selectedId !== edge.to;
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
        minZoom={16}
        maxZoom={60}
        maxPolarAngle={Math.PI / 2.2}
        target={CAMERA_TARGET}
      />
    </Canvas>
  );
}

function RoleFloor({ floor }: { floor: SwarmVisualFloor }) {
  const color = ROLE_HEX[floor.role];
  return (
    <group position={floor.center}>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[floor.width, 0.12, floor.depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.34}
          metalness={0.12}
          roughness={0.5}
          emissive={color}
          emissiveIntensity={0.18}
        />
      </mesh>
      <Billboard position={[-floor.width / 2 + 0.2, 0.22, floor.depth / 2]}>
        <Text fontSize={0.18} color={color} anchorX="left" anchorY="middle">
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
      <mesh>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#9aa4b5" transparent opacity={0.22} roughness={0.65} />
      </mesh>
      <Billboard position={[-width / 2 + 0.15, 0.22, depth / 2]}>
        <Text fontSize={0.16} color="#9aa4b5" anchorX="left" anchorY="middle">
          SHARED BOARD
        </Text>
      </Billboard>
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
  const geometry = useMemo(() => {
    const start = new THREE.Vector3(from[0], from[1] + 0.82 * fromScale, from[2]);
    const end = new THREE.Vector3(to[0], to[1] + (type === "work" ? 0.24 : 0.74), to[2]);
    const mid = new THREE.Vector3(
      (start.x + end.x) / 2,
      Math.max(start.y, end.y) + (type === "spawn" ? 1.05 : 0.5),
      (start.z + end.z) / 2,
    );
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    return new THREE.TubeGeometry(curve, 28, type === "spawn" ? 0.022 : 0.014, 8, false);
  }, [from, to, type, fromScale]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={dim ? 0.08 : type === "spawn" ? 0.55 : 0.3}
        transparent
        opacity={dim ? 0.16 : type === "spawn" ? 0.85 : 0.65}
        depthWrite={false}
      />
    </mesh>
  );
}

function WorkChip({ node, active }: { node: SwarmVisualWorkNode; active: boolean }) {
  return (
    <group position={node.position}>
      <mesh>
        <boxGeometry args={[1.55, 0.18, 0.72]} />
        <meshStandardMaterial
          color={active ? "#8ec5ff" : "#9aa4b5"}
          emissive={active ? "#8ec5ff" : "#9aa4b5"}
          emissiveIntensity={active ? 0.35 : 0.08}
          transparent
          opacity={active ? 0.5 : 0.28}
        />
      </mesh>
      <Billboard position={[0, 0.38, 0]}>
        <Text fontSize={0.13} color="#f0f0f0" anchorX="center" anchorY="bottom" maxWidth={1.5}>
          {node.title}
        </Text>
        <Text fontSize={0.1} color="#9aa4b5" anchorX="center" anchorY="top" position={[0, -0.02, 0]}>
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
  const color = ROLE_HEX[agent.role];
  const dead = agent.visualStatus === "dead" || agent.visualStatus === "error";
  const working = agent.visualStatus === "working";
  const opacity = dim ? 0.32 : dead ? 0.5 : 1;
  const scale = agent.scale;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.position.y = agent.position[1] + (working ? Math.sin(t * 2.4) * 0.04 : 0);
      if (working) group.current.rotation.y = Math.sin(t * 1.1) * 0.1;
    }
    if (glow.current) {
      const mat = glow.current.material as THREE.MeshStandardMaterial;
      mat.opacity = working ? 0.22 + Math.sin(t * 3.2) * 0.08 : 0.05;
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
        <sphereGeometry args={[0.7, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={working ? 1 : 0.15}
          transparent
          opacity={0.08}
          depthWrite={false}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[0.26, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.4} />
      </mesh>

      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.32, 0.4, 28]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} />
        </mesh>
      )}

      <mesh position={[-0.07, 0.2, 0]}>
        <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0.07, 0.2, 0]}>
        <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0, 0.54, 0]}>
        <capsuleGeometry args={[0.14, 0.3, 6, 12]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[-0.22, working ? 0.7 : 0.54, 0]} rotation={[0, 0, working ? 0.95 : 0.38]}>
        <capsuleGeometry args={[0.032, 0.26, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0.22, 0.54, 0]} rotation={[0, 0, -0.38]}>
        <capsuleGeometry args={[0.032, 0.26, 4, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0, 0.88, 0]}>
        <sphereGeometry args={[0.14, 18, 18]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[-0.045, 0.9, 0.11]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>
      <mesh position={[0.045, 0.9, 0.11]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshStandardMaterial color="#0d1118" />
      </mesh>
      <mesh position={[0, 1.06, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.18, 8]} />
        <BodyMaterial color={color} opacity={opacity} working={working} />
      </mesh>
      <mesh position={[0, 1.18, 0]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={working ? 1.6 : 0.4}
          transparent
          opacity={opacity}
        />
      </mesh>

      {agent.role === "orchestrator" && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 1.0, 0]}>
          <torusGeometry args={[0.3, 0.02, 10, 28]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} />
        </mesh>
      )}

      {agent.visualStatus === "error" && (
        <mesh position={[0.18, 1.0, 0.08]} rotation={[0, 0, -0.7]}>
          <boxGeometry args={[0.3, 0.03, 0.03]} />
          <meshStandardMaterial color="#f07070" emissive="#f07070" emissiveIntensity={0.9} />
        </mesh>
      )}

      <Billboard position={[0, dead ? 1.32 : 1.5, 0]}>
        <Text fontSize={0.16} color={dim ? "#8a8a8a" : "#f2f2f2"} anchorX="center" anchorY="bottom">
          @{agent.label}
        </Text>
        <Text fontSize={0.12} color={color} anchorX="center" anchorY="top" position={[0, -0.02, 0]}>
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
      emissiveIntensity={working ? 0.55 : 0.2}
      metalness={0.18}
      roughness={0.4}
      transparent
      opacity={opacity}
    />
  );
}
