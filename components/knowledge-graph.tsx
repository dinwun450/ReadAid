"use client";

import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { GraphResult } from "@/lib/contracts";

type GraphNodeData = { label: string; kind: "character" | "theme" | "event"; active: boolean; dimmed: boolean; central: boolean };

function StoryNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const icon = data.kind === "character" ? "●" : data.kind === "theme" ? "◇" : "◆";
  return (
    <div className={`story-node ${data.kind} ${data.central ? "central" : ""} ${data.active ? "active" : ""} ${data.dimmed ? "dimmed" : ""}`} aria-label={`${data.kind}: ${data.label}${data.active ? ", highlighted" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span aria-hidden="true" className="node-icon">{icon}</span>
      <span>{data.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { story: StoryNode };

export function KnowledgeGraph({ graph, activeNodeIds, activeEdgeIds, focus }: { graph: GraphResult; activeNodeIds: string[]; activeEdgeIds: string[]; focus: boolean }) {
  const visible = useMemo(() => {
    if (!focus || activeNodeIds.length === 0) return graph.nodes;
    const active = graph.nodes.filter((node) => activeNodeIds.includes(node.id));
    if (active.length === 0) return graph.nodes;
    const neighbors = graph.edges.filter((edge) => activeNodeIds.includes(edge.source) || activeNodeIds.includes(edge.target)).flatMap((edge) => [edge.source, edge.target]);
    return graph.nodes.filter((node) => active.some((item) => item.id === node.id) || neighbors.includes(node.id)).slice(0, 5);
  }, [activeNodeIds, focus, graph]);

  const visibleIds = new Set(visible.map((node) => node.id));
  const matchingActiveNodeIds = activeNodeIds.filter((id) => visibleIds.has(id));
  const centralId = visible.reduce((bestId, node) => {
    const degree = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
    const bestDegree = graph.edges.filter((edge) => edge.source === bestId || edge.target === bestId).length;
    return degree > bestDegree ? node.id : bestId;
  }, visible[0]?.id || "");
  const peripheralNodes = visible.filter((node) => node.id !== centralId);
  const nodes: Node<GraphNodeData>[] = visible.map((node) => {
    const central = node.id === centralId;
    const peripheralIndex = peripheralNodes.findIndex((item) => item.id === node.id);
    const angle = (peripheralIndex / Math.max(peripheralNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radiusX = visible.length < 4 ? 210 : 300;
    const radiusY = visible.length < 4 ? 155 : 215;
    const active = matchingActiveNodeIds.includes(node.id);
    return {
      id: node.id,
      type: "story",
      position: central ? { x: 320, y: 235 } : { x: 320 + Math.cos(angle) * radiusX, y: 235 + Math.sin(angle) * radiusY },
      data: { label: node.label, kind: node.type, active, dimmed: matchingActiveNodeIds.length > 0 && !active, central },
      draggable: false,
      selectable: true,
    };
  });
  const visibleEdgeIds = new Set(graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => edge.id));
  const matchingActiveEdgeIds = activeEdgeIds.filter((id) => visibleEdgeIds.has(id));
  const edges: Edge[] = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => {
    const active = matchingActiveEdgeIds.includes(edge.id);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: false,
      className: `${edge.inferred ? "inferred-edge" : "explicit-edge"} ${active ? "active-edge" : matchingActiveEdgeIds.length ? "dimmed-edge" : ""}`,
      style: { strokeWidth: active ? 5 : 2.5 },
      labelStyle: { fontSize: 12, fontWeight: active ? 750 : 600, fill: "#33423d" },
    };
  });
  const graphKey = `${nodes.map((node) => node.id).join(",")}|${edges.map((edge) => edge.id).join(",")}`;

  const description = graph.edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)?.label || edge.source;
    const target = graph.nodes.find((node) => node.id === edge.target)?.label || edge.target;
    return `${source} ${edge.label} ${target}${edge.inferred ? " (inferred)" : " (stated)"}`;
  }).join(". ");

  return (
    <>
      <div className="graph-canvas" role="img" aria-label="Knowledge graph. A text description follows.">
        <ReactFlow key={graphKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.55} maxZoom={1.45} nodesConnectable={false} elementsSelectable attributionPosition="bottom-left">
          <Background color="#d8dfda" gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <details className="graph-description">
        <summary>Read graph as text</summary>
        <p>{description || "No supported relationships are available yet."}</p>
        <p><span className="legend-line solid" /> Solid means stated in the passage. <span className="legend-line dashed" /> Dashed means inferred.</p>
      </details>
    </>
  );
}
