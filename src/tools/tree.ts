import { getProjectRoot, getChildren, getSubtreeProgress, listProjects } from "../nodes.js";
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
  progress?: { resolved: number; total: number };
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

function buildTree(
  node: Node,
  currentDepth: number,
  maxDepth: number,
  stats: { total: number; resolved: number }
): { treeNode: TreeNode; subtotal: number; subresolved: number } {
  stats.total++;
  if (node.resolved) stats.resolved++;

  const children = getChildren(node.id);
  const treeNode: TreeNode = {
    id: node.id,
    summary: node.summary,
    resolved: node.resolved,
    properties: node.properties,
  };

  let subtotal = 1;
  let subresolved = node.resolved ? 1 : 0;

  if (children.length === 0) return { treeNode, subtotal, subresolved };

  if (currentDepth < maxDepth) {
    treeNode.children = [];
    for (const child of children) {
      const result = buildTree(child, currentDepth + 1, maxDepth, stats);
      treeNode.children.push(result.treeNode);
      subtotal += result.subtotal;
      subresolved += result.subresolved;
    }
  } else {
    treeNode.child_count = children.length;
    // Count descendants via SQL when truncating at depth limit
    const progress = getSubtreeProgress(node.id);
    subtotal = progress.total;
    subresolved = progress.resolved;
  }

  treeNode.progress = { resolved: subresolved, total: subtotal };
  return { treeNode, subtotal, subresolved };
}

export function handleTree(input: TreeInput): TreeResult {
  const project = requireString(input?.project, "project");
  const depth = optionalNumber(input?.depth, "depth", 1, 20) ?? 10;

  const root = getProjectRoot(project);
  if (!root) {
    const available = listProjects();
    const names = available.map((p) => p.project);
    const suffix = names.length > 0
      ? ` Available projects: ${names.join(", ")}`
      : " No projects exist yet.";
    throw new EngineError("project_not_found", `Project not found: ${project}.${suffix}`);
  }

  const stats = { total: 0, resolved: 0 };
  const { treeNode } = buildTree(root, 0, depth, stats);

  return {
    project,
    tree: treeNode,
    stats: {
      total: stats.total,
      resolved: stats.resolved,
      unresolved: stats.total - stats.resolved,
    },
  };
}
