"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_TYPES, getNodeDef, type NodeTypeDef } from "@/lib/shader-graph/nodes";

// ── Custom node renderer ──────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  input: "#5a9ecc",
  math: "#c47be8",
  utility: "#7bc24a",
  output: "#e8875a",
};

const TYPE_COLORS: Record<string, string> = {
  float: "#aaa",
  vec2: "#7bc24a",
  vec3: "#5a9ecc",
  vec4: "#e8875a",
  sampler2D: "#c47be8",
};

function ShaderNode({ id, data, type }: NodeProps & { type: string }) {
  const def: NodeTypeDef | undefined = getNodeDef(type);
  const { updateNodeData } = useReactFlow();
  if (!def) return null;
  const accent = CATEGORY_COLORS[def.category] ?? "#888";

  return (
    <div
      style={{
        minWidth: 140,
        background: "#18141c",
        border: `1px solid ${accent}55`,
        borderTop: `2px solid ${accent}`,
        borderRadius: 8,
        fontSize: 11,
        color: "#e0d8ec",
        boxShadow: "0 4px 16px #0008",
      }}
    >
      {/* Header */}
      <div style={{ padding: "6px 10px 4px", fontWeight: 700, color: accent, letterSpacing: "0.04em" }}>
        {def.label}
      </div>

      {/* Body: inputs left, outputs right */}
      <div style={{ padding: "4px 0 6px", position: "relative" }}>
        {/* Outputs (right side) */}
        {def.outputs.map((slot, i) => (
          <div key={slot.id} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "2px 10px 2px 24px", position: "relative" }}>
            <span style={{ color: TYPE_COLORS[slot.type] ?? "#aaa", marginRight: 6, fontSize: 10 }}>{slot.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={slot.id}
              style={{ right: -6, top: "50%", background: TYPE_COLORS[slot.type] ?? "#aaa", width: 10, height: 10, border: "2px solid #18141c" }}
            />
          </div>
        ))}

        {/* Inputs (left side) */}
        {def.inputs.map((slot) => (
          <div key={slot.id} style={{ display: "flex", alignItems: "center", padding: "2px 24px 2px 10px", position: "relative" }}>
            <Handle
              type="target"
              position={Position.Left}
              id={slot.id}
              style={{ left: -6, top: "50%", background: TYPE_COLORS[slot.type] ?? "#aaa", width: 10, height: 10, border: "2px solid #18141c" }}
            />
            <span style={{ color: "#9990aa", fontSize: 10 }}>{slot.label}</span>
          </div>
        ))}

        {/* Float value display */}
        {type === "Float" && (
          <div style={{ padding: "2px 10px", color: "#e8875a", fontFamily: "monospace" }}>
            {String((data.value as number ?? 0).toFixed(3))}
          </div>
        )}

        {/* Color swatch */}
        {type === "Color" && (
          <div style={{ margin: "4px 10px", height: 16, borderRadius: 4, background: `rgba(${Math.round((data.r as number ?? 1) * 255)},${Math.round((data.g as number ?? 1) * 255)},${Math.round((data.b as number ?? 1) * 255)},${data.a as number ?? 1})` }} />
        )}

        {/* Texture2D image picker */}
        {type === "Texture2D" && (
          <div style={{ padding: "4px 10px 6px" }}>
            {(data.imageUrl as string) ? (
              <div style={{ position: "relative" }}>
                <img
                  src={data.imageUrl as string}
                  style={{ width: "100%", height: 56, objectFit: "cover", borderRadius: 4, display: "block" }}
                  alt="texture"
                />
                <label
                  title="Replace image"
                  style={{ position: "absolute", inset: 0, cursor: "pointer", borderRadius: 4 }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => updateNodeData(id, { imageUrl: reader.result as string });
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </div>
            ) : (
              <label
                style={{
                  display: "block",
                  cursor: "pointer",
                  border: "1px dashed #5a4455",
                  borderRadius: 4,
                  padding: "6px",
                  textAlign: "center",
                  color: "#9980aa",
                  fontSize: 10,
                }}
              >
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => updateNodeData(id, { imageUrl: reader.result as string });
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Build React Flow nodeTypes map from our NODE_TYPES list
const RF_NODE_TYPES: Record<string, React.ComponentType<NodeProps>> = {};
for (const def of NODE_TYPES) {
  const nodeType = def.type;
  RF_NODE_TYPES[nodeType] = (props: NodeProps) => <ShaderNode {...props} type={nodeType} />;
}

// ── Default starter graph ────────────────────────────────────────────────────

const INITIAL_NODES: Node[] = [
  {
    id: "uv1",
    type: "UV",
    position: { x: 60, y: 120 },
    data: {},
  },
  {
    id: "color1",
    type: "Color",
    position: { x: 60, y: 220 },
    data: { r: 0.2, g: 0.6, b: 1, a: 1 },
  },
  {
    id: "time1",
    type: "Time",
    position: { x: 60, y: 330 },
    data: {},
  },
  {
    id: "sin1",
    type: "Sin",
    position: { x: 260, y: 330 },
    data: {},
  },
  {
    id: "mix1",
    type: "Mix",
    position: { x: 440, y: 200 },
    data: {},
  },
  {
    id: "out1",
    type: "OutputUnlit",
    position: { x: 640, y: 200 },
    data: { outputMode: "unlit" },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: "e-time-sin", source: "time1", sourceHandle: "time", target: "sin1", targetHandle: "x" },
  { id: "e-uv-mix-a", source: "uv1", sourceHandle: "uv", target: "mix1", targetHandle: "a" },
  { id: "e-color-mix-b", source: "color1", sourceHandle: "color", target: "mix1", targetHandle: "b" },
  { id: "e-sin-mix-t", source: "sin1", sourceHandle: "result", target: "mix1", targetHandle: "t" },
  { id: "e-mix-out", source: "mix1", sourceHandle: "result", target: "out1", targetHandle: "color" },
];

// ── Main NodeCanvas component ────────────────────────────────────────────────

type Props = {
  onGraphChange: (nodes: Node[], edges: Edge[]) => void;
};

export default function NodeCanvas({ onGraphChange }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...params, animated: false }, eds);
        return next;
      });
    },
    [setEdges],
  );

  // Notify parent whenever graph changes
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Use setTimeout to read updated state after React applies changes
      setTimeout(() => onGraphChange(nodes, edges), 0);
    },
    [onNodesChange, nodes, edges, onGraphChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      setTimeout(() => onGraphChange(nodes, edges), 0);
    },
    [onEdgesChange, nodes, edges, onGraphChange],
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      onConnect(params);
      setTimeout(() => onGraphChange(nodes, edges), 0);
    },
    [onConnect, nodes, edges, onGraphChange],
  );

  // Add node from the palette
  const addNode = useCallback(
    (type: string) => {
      const def = getNodeDef(type);
      if (!def) return;
      const id = `${type}_${Date.now()}`;
      const newNode: Node = {
        id,
        type,
        position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: { ...(def.defaultData ?? {}) },
      };
      setNodes((ns) => [...ns, newNode]);
      setTimeout(() => onGraphChange([...nodes, newNode], edges), 0);
    },
    [nodes, edges, setNodes, onGraphChange],
  );

  const categories: Array<{ label: string; key: string }> = [
    { label: "Inputs", key: "input" },
    { label: "Math", key: "math" },
    { label: "Utility", key: "utility" },
    { label: "Output", key: "output" },
  ];

  return (
    <div className="flex h-full">
      {/* Node palette */}
      <div className="w-44 flex-shrink-0 border-r border-[#2a2320] overflow-y-auto bg-[#0e0b08]">
        <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-dim">Nodes</p>
        {categories.map((cat) => (
          <div key={cat.key} className="mb-2">
            <p className="px-3 py-1 text-[10px] text-dim uppercase tracking-wider" style={{ color: CATEGORY_COLORS[cat.key] }}>
              {cat.label}
            </p>
            {NODE_TYPES.filter((n) => n.category === cat.key).map((n) => (
              <button
                key={n.type}
                onClick={() => addNode(n.type)}
                className="w-full text-left px-3 py-1 text-[11px] text-ink hover:bg-[#1e1a17] transition-colors"
              >
                {n.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div className="flex-1" style={{ background: "#0e0b08" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          nodeTypes={RF_NODE_TYPES}
          fitView
          style={{ background: "#0e0b08" }}
          defaultEdgeOptions={{ style: { stroke: "#554455", strokeWidth: 1.5 } }}
        >
          <Background color="#2a2430" variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls style={{ background: "#18141c", borderColor: "#2a2320", color: "#888" }} />
          <MiniMap style={{ background: "#18141c", borderColor: "#2a2320" }} nodeColor="#c47be8" maskColor="#0e0b0888" />
        </ReactFlow>
      </div>
    </div>
  );
}
