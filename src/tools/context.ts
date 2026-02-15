import { getNodeOrThrow, getChildren, getAncestors } from "../nodes.js";
import { getEdgesFrom, getEdgesTo } from "../edges.js";
import { getNode } from "../nodes.js";
import { requireString, optionalNumber } from "../validate.js";
import type { Node } from "../types.js";

export interface ContextInput {
  node_id: string;
  depth?: number;
}

interface NodeTree {
  id: string;
  summary: string;
  resolved: boolean;
  state: unknown;
  children?: NodeTree[];
  child_count?: number;
}

export interface ContextResult {
  node: Node;
  ancestors: Array<{ id: string; summary: string; resolved: boolean }>;
  children: NodeTree;
  depends_on: Array<{ node: Node; satisfied: boolean }>;
  depended_by: Array<{ node: Node; satisfied: boolean }>;
}

function buildNodeTree(nodeId: string, currentDepth: number, maxDepth: number): NodeTree {
  const node = getNodeOrThrow(nodeId);
  const children = getChildren(nodeId);

  const tree: NodeTree = {
    id: node.id,
    summary: node.summary,
    resolved: node.resolved,
    state: node.state,
  };

  if (children.length === 0) {
    return tree;
  }

  if (currentDepth < maxDepth) {
    tree.children = children.map((child) =>
      buildNodeTree(child.id, currentDepth + 1, maxDepth)
    );
  } else {
    tree.child_count = children.length;
  }

  return tree;
}

export function handleContext(input: ContextInput): ContextResult {
  const nodeId = requireString(input?.node_id, "node_id");
  const depth = optionalNumber(input?.depth, "depth", 0, 10) ?? 2;
  const node = getNodeOrThrow(nodeId);
  const ancestors = getAncestors(nodeId);

  // Build children tree
  const children = buildNodeTree(nodeId, 0, depth);

  // Get dependency edges
  const depsOut = getEdgesFrom(nodeId, "depends_on");
  const depsIn = getEdgesTo(nodeId, "depends_on");

  const depends_on = depsOut.map((edge) => {
    const target = getNode(edge.to_node);
    return {
      node: target!,
      satisfied: target?.resolved ?? false,
    };
  });

  const depended_by = depsIn.map((edge) => {
    const source = getNode(edge.from_node);
    return {
      node: source!,
      satisfied: node.resolved,
    };
  });

  return { node, ancestors, children, depends_on, depended_by };
}
