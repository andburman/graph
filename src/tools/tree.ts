import { getProjectRoot, getChildren } from "../nodes.js";
import { requireString, optionalNumber } from "../validate.js";
import { EngineError } from "../validate.js";
import type { Node } from "../types.js";

// [sl:ahq-BLHS9pJkJUlBZO92L] Full tree visualization — "show me the whole tree"

export interface TreeInput {
  project: string;
  depth?: number;
}

interface TreeNode {
  id: string;
  summary: string;
  resolved: boolean;
  properties: Record<string, unknown>;
  children?: TreeNode[];
  child_count?: number;
}

export interface TreeResult {
  project: string;
  tree: TreeNode;
  stats: {
    total: number;
    resolved: number;
    unresolved: number;
  };
}

function buildTree(node: Node, currentDepth: number, maxDepth: number, stats: { total: number; resolved: number }): TreeNode {
  stats.total++;
  if (node.resolved) stats.resolved++;

  const children = getChildren(node.id);
  const treeNode: TreeNode = {
    id: node.id,
    summary: node.summary,
    resolved: node.resolved,
    properties: node.properties,
  };

  if (children.length === 0) return treeNode;

  if (currentDepth < maxDepth) {
    treeNode.children = children.map((child) =>
      buildTree(child, currentDepth + 1, maxDepth, stats)
    );
  } else {
    treeNode.child_count = children.length;
  }

  return treeNode;
}

export function handleTree(input: TreeInput): TreeResult {
  const project = requireString(input?.project, "project");
  const depth = optionalNumber(input?.depth, "depth", 1, 20) ?? 10;

  const root = getProjectRoot(project);
  if (!root) {
    throw new EngineError("project_not_found", `Project not found: ${project}`);
  }

  const stats = { total: 0, resolved: 0 };
  const tree = buildTree(root, 0, depth, stats);

  return {
    project,
    tree,
    stats: {
      total: stats.total,
      resolved: stats.resolved,
      unresolved: stats.total - stats.resolved,
    },
  };
}
