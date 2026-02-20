import { createNode, getProjectRoot, listProjects, getProjectSummary } from "../nodes.js";
import { optionalString } from "../validate.js";
import type { Node } from "../types.js";

export interface OpenInput {
  project?: string;
  goal?: string;
}

export type OpenResult =
  | {
      projects: Array<{
        project: string;
        id: string;
        summary: string;
        total: number;
        resolved: number;
        unresolved: number;
        updated_at: string;
      }>;
    }
  | {
      project: string;
      root: Node;
      summary: {
        total: number;
        resolved: number;
        unresolved: number;
        blocked: number;
        actionable: number;
      };
    };

export function handleOpen(input: OpenInput, agent: string): OpenResult {
  const project = optionalString(input?.project, "project");
  const goal = optionalString(input?.goal, "goal");

  if (!project) {
    return { projects: listProjects() };
  }

  let root = getProjectRoot(project);

  if (!root) {
    root = createNode({
      project,
      summary: goal ?? project,
      discovery: "pending",
      agent,
    });
  }

  const summary = getProjectSummary(project);

  return { project, root, summary };
}
