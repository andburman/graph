import { useState, useEffect, useCallback } from 'react'
import './App.css'

// --- Types ---

interface ProjectSummary {
  project: string
  id: string
  summary: string
  total: number
  resolved: number
  unresolved: number
  blocked: number
  actionable: number
}

interface NodeData {
  id: string
  summary: string
  resolved: boolean
  depth: number
  discovery: string | null
  blocked: boolean
  blocked_reason: string | null
  properties: Record<string, unknown>
  evidence: Array<{ type: string; ref: string; agent: string; timestamp: string }>
  context_links: string[]
  parent: string | null
  project: string
  created_at: string
  updated_at: string
}

interface TreeNode extends NodeData {
  children?: TreeNode[]
}

interface TreeApiResponse {
  project: string
  root_id: string
  nodes: NodeData[]
  edges: Array<{ from_node: string; to_node: string; type: string }>
  stats: { total: number; resolved: number; unresolved: number }
}

// Aggregated intent types

interface OpenDecision {
  id: string
  question: string
  status: string
  answer?: string
  rationale?: string
  nodeId: string
  nodeSummary: string
}

interface UntestedAssumption {
  id: string
  text: string
  status: string
  nodeId: string
  nodeSummary: string
}

interface UnscopedEdgeCase {
  id: string
  case: string
  scope: string | null
  handling?: string
  nodeId: string
  nodeSummary: string
}

interface UnconfirmedDod {
  id: string
  criterion: string
  met: boolean | null
  nodeId: string
  nodeSummary: string
}

type DiscoveryPhase = 'raw' | 'decomposed' | 'in_review' | 'deciding' | 'ready'

interface IntentSummary {
  node: TreeNode
  progress: { resolved: number; total: number }
  worstPhase: DiscoveryPhase
  phaseCounts: Record<DiscoveryPhase, number>
  openDecisions: OpenDecision[]
  untestedAssumptions: UntestedAssumption[]
  unscopedEdgeCases: UnscopedEdgeCase[]
  unconfirmedDod: UnconfirmedDod[]
  blockedNodes: Array<{ id: string; summary: string; reason: string | null }>
  staleNodes: Array<{ id: string; summary: string; daysSince: number }>
  priority: number | undefined
  project: string
  updatedAt: string
}

function buildTree(nodes: NodeData[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  for (const n of nodes) {
    map.set(n.id, { ...n, children: [] })
  }
  for (const n of nodes) {
    const treeNode = map.get(n.id)!
    if (n.parent && map.has(n.parent)) {
      map.get(n.parent)!.children!.push(treeNode)
    } else {
      roots.push(treeNode)
    }
  }
  return roots
}

// --- Helpers ---

function getTheme(): 'dark' | 'light' {
  return (localStorage.getItem('graph-ui-theme') as 'dark' | 'light') || 'dark'
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (isNaN(diff)) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

type DiscoveryArtifacts = {
  assumptions?: Array<{ id: string; text: string; status: string; response?: string }>
  decisions?: Array<{ id: string; question: string; status: string; answer?: string; rationale?: string }>
  edge_cases?: Array<{ id: string; case: string; scope: string | null; handling?: string }>
  definition_of_done?: Array<{ id: string; criterion: string; met: boolean | null }>
}

function computeDiscoveryPhase(node: NodeData): DiscoveryPhase {
  const artifacts = node.properties?.discovery_artifacts as DiscoveryArtifacts | undefined

  if (!artifacts) return 'raw'

  const assumptions = artifacts.assumptions || []
  const decisions = artifacts.decisions || []
  const edgeCases = artifacts.edge_cases || []
  const dod = artifacts.definition_of_done || []

  if (decisions.some(d => d.status === 'open')) return 'deciding'
  if (assumptions.length > 0 && assumptions.some(a => a.status === 'untested')) return 'decomposed'

  const unscopedEdges = edgeCases.some(e => e.scope === null)
  const unmetDod = dod.length === 0 || dod.some(d => d.met === null)
  if (assumptions.length > 0 && (unscopedEdges || unmetDod)) return 'in_review'

  if (assumptions.length > 0) return 'ready'

  return 'raw'
}

function phaseLabel(phase: DiscoveryPhase): string {
  switch (phase) {
    case 'raw': return 'raw'
    case 'decomposed': return 'decomposed'
    case 'in_review': return 'in review'
    case 'deciding': return 'deciding'
    case 'ready': return 'ready'
  }
}

function phaseOrder(phase: DiscoveryPhase): number {
  switch (phase) {
    case 'deciding': return 0
    case 'in_review': return 1
    case 'decomposed': return 2
    case 'raw': return 3
    case 'ready': return 4
  }
}

// --- Aggregation ---

function collectDescendants(node: TreeNode): TreeNode[] {
  const result: TreeNode[] = []
  const walk = (n: TreeNode) => {
    for (const child of n.children || []) {
      result.push(child)
      walk(child)
    }
  }
  walk(node)
  return result
}

function aggregateIntent(intentNode: TreeNode, project: string): IntentSummary {
  const descendants = collectDescendants(intentNode)
  const allNodes = [intentNode, ...descendants]

  const total = allNodes.length
  const resolved = allNodes.filter(n => n.resolved).length

  let worstPhase: DiscoveryPhase = 'ready'
  const phaseCounts: Record<DiscoveryPhase, number> = { raw: 0, decomposed: 0, in_review: 0, deciding: 0, ready: 0 }

  const openDecisions: OpenDecision[] = []
  const untestedAssumptions: UntestedAssumption[] = []
  const unscopedEdgeCases: UnscopedEdgeCase[] = []
  const unconfirmedDod: UnconfirmedDod[] = []
  const blockedNodes: Array<{ id: string; summary: string; reason: string | null }> = []
  const staleNodes: Array<{ id: string; summary: string; daysSince: number }> = []

  for (const n of allNodes) {
    if (n.resolved) continue

    const phase = computeDiscoveryPhase(n)
    phaseCounts[phase]++
    if (phaseOrder(phase) < phaseOrder(worstPhase)) {
      worstPhase = phase
    }

    if (n.blocked) {
      blockedNodes.push({ id: n.id, summary: n.summary, reason: n.blocked_reason })
    }

    const daysSince = (Date.now() - new Date(n.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince > 3) {
      staleNodes.push({ id: n.id, summary: n.summary, daysSince: Math.round(daysSince) })
    }

    const artifacts = n.properties?.discovery_artifacts as DiscoveryArtifacts | undefined
    if (!artifacts) continue

    const shortName = n.summary.slice(0, 40)

    for (const d of artifacts.decisions || []) {
      if (d.status === 'open') {
        openDecisions.push({ ...d, nodeId: n.id, nodeSummary: shortName })
      }
    }
    for (const a of artifacts.assumptions || []) {
      if (a.status === 'untested') {
        untestedAssumptions.push({ ...a, nodeId: n.id, nodeSummary: shortName })
      }
    }
    for (const e of artifacts.edge_cases || []) {
      if (e.scope === null) {
        unscopedEdgeCases.push({ ...e, nodeId: n.id, nodeSummary: shortName })
      }
    }
    for (const d of artifacts.definition_of_done || []) {
      if (d.met === null) {
        unconfirmedDod.push({ ...d, nodeId: n.id, nodeSummary: shortName })
      }
    }
  }

  staleNodes.sort((a, b) => b.daysSince - a.daysSince)

  const priority = intentNode.properties?.priority as number | undefined
  const updatedAt = allNodes.reduce(
    (latest, n) => (n.updated_at > latest ? n.updated_at : latest),
    intentNode.updated_at,
  )

  return {
    node: intentNode,
    progress: { resolved, total },
    worstPhase,
    phaseCounts,
    openDecisions,
    untestedAssumptions,
    unscopedEdgeCases,
    unconfirmedDod,
    blockedNodes,
    staleNodes,
    priority,
    project,
    updatedAt,
  }
}

function getIntentSignal(intent: IntentSummary): { type: string; message: string } | null {
  if (intent.blockedNodes.length > 0) {
    const n = intent.blockedNodes.length
    return { type: 'blocked', message: `${n} blocked` }
  }
  if (intent.openDecisions.length > 0) {
    const n = intent.openDecisions.length
    return { type: 'decisions', message: `${n} decision${n !== 1 ? 's' : ''} waiting` }
  }
  if (intent.untestedAssumptions.length > 0) {
    const n = intent.untestedAssumptions.length
    return { type: 'assumptions', message: `${n} assumption${n !== 1 ? 's' : ''} to validate` }
  }
  const reviewCount = intent.unscopedEdgeCases.length + intent.unconfirmedDod.length
  if (reviewCount > 0) {
    return { type: 'review', message: `${reviewCount} item${reviewCount !== 1 ? 's' : ''} to review` }
  }
  if (intent.staleNodes.length > 0) {
    const n = intent.staleNodes.length
    return { type: 'stale', message: `${n} stale` }
  }
  return null
}

// --- Components ---

function Header({ theme, onToggleTheme, projects }: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  projects: ProjectSummary[]
}) {
  const totalUnresolved = projects.reduce((s, p) => s + p.unresolved, 0)
  const totalBlocked = projects.reduce((s, p) => s + p.blocked, 0)

  return (
    <header className="header">
      <div className="header-left">
        <span className="header-title">Graph</span>
      </div>
      <div className="header-right">
        <div className="metric">
          <span className={`metric-dot ${totalBlocked > 0 ? 'red' : 'green'}`} />
          <span>{totalUnresolved} open</span>
        </div>
        {totalBlocked > 0 && (
          <div className="metric">
            <span className="metric-dot orange" />
            <span>{totalBlocked} blocked</span>
          </div>
        )}
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}

function IntentRow({ intent, isSelected, onClick }: {
  intent: IntentSummary
  isSelected: boolean
  onClick: () => void
}) {
  const signal = getIntentSignal(intent)
  const { resolved, total } = intent.progress
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0
  const hasChildren = (intent.node.children || []).length > 0

  return (
    <div className={`intent-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="intent-item-row1">
        <span className="intent-item-tag">{intent.project}</span>
        <span className="intent-item-summary">{intent.node.summary}</span>
        <span className="intent-item-age">{timeAgo(intent.updatedAt)}</span>
      </div>
      <div className="intent-item-row2">
        {signal && <span className={`intent-item-signal signal-${signal.type}`}>{signal.message}</span>}
        <span className={`intent-item-phase ${intent.worstPhase.replace('_', '-')}`}>
          {phaseLabel(intent.worstPhase)}
        </span>
        {hasChildren && (
          <span className="intent-progress">
            <span className="intent-progress-track">
              <span className="intent-progress-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="intent-progress-label">{resolved}/{total}</span>
          </span>
        )}
        {!hasChildren && <span className="intent-not-decomposed">not decomposed</span>}
        {intent.priority != null && <span className="intent-item-priority">P{intent.priority}</span>}
      </div>
    </div>
  )
}

async function artifactAction(
  nodeId: string,
  artifact_type: string,
  artifact_id: string,
  action: string,
  value?: unknown,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/artifact-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_type, artifact_id, action, value }),
    })
    return res.ok
  } catch { return false }
}

function IntentDetailPanel({ intent, onMutate }: { intent: IntentSummary | null; onMutate: () => void }) {
  const [deciding, setDeciding] = useState<{ nodeId: string; decisionId: string } | null>(null)
  const [decisionAnswer, setDecisionAnswer] = useState('')
  const [decisionRationale, setDecisionRationale] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  // Reset form state when selected intent changes
  useEffect(() => {
    setDeciding(null)
    setDecisionAnswer('')
    setDecisionRationale('')
  }, [intent?.node.id])

  if (!intent) {
    return (
      <aside className="panel">
        <div className="panel-empty">Select an intent to see details</div>
      </aside>
    )
  }

  const { resolved, total } = intent.progress
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0
  const hasChildren = (intent.node.children || []).length > 0

  const act = async (nodeId: string, type: string, id: string, action: string, value?: unknown) => {
    setBusy(`${nodeId}:${type}:${id}:${action}`)
    const ok = await artifactAction(nodeId, type, id, action, value)
    setBusy(null)
    if (ok) onMutate()
  }

  const isBusy = (nodeId: string, type: string, id: string, action: string) =>
    busy === `${nodeId}:${type}:${id}:${action}`

  const attentionCount = intent.openDecisions.length + intent.untestedAssumptions.length
    + intent.unscopedEdgeCases.length + intent.unconfirmedDod.length

  return (
    <aside className="panel">
      <div className="panel-title">{intent.node.summary}</div>

      {/* Metadata */}
      <div className="panel-section">
        <div className="panel-meta">
          <span className={`panel-phase-badge ${intent.worstPhase.replace('_', '-')}`}>
            {phaseLabel(intent.worstPhase)}
          </span>
          <span className="panel-meta-item">{intent.project}</span>
          {intent.priority != null && <span className="panel-meta-item">P{intent.priority}</span>}
          <span className="panel-meta-item">updated {timeAgo(intent.updatedAt)}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="panel-section">
        <div className="panel-section-title">Progress</div>
        {hasChildren ? (
          <>
            <div className="panel-progress">
              <div className="panel-progress-bar">
                <div className="panel-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="panel-progress-text">{resolved} of {total} resolved</span>
            </div>
            <div className="phase-distribution">
              {(Object.entries(intent.phaseCounts) as [DiscoveryPhase, number][])
                .filter(([, count]) => count > 0)
                .map(([phase, count]) => (
                  <span key={phase} className={`phase-count ${phase.replace('_', '-')}`}>
                    {phaseLabel(phase)}: {count}
                  </span>
                ))}
            </div>
          </>
        ) : (
          <div className="panel-progress-text">Not decomposed yet</div>
        )}
      </div>

      {/* Open Decisions */}
      {intent.openDecisions.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">
            Decisions ({intent.openDecisions.length})
          </div>
          {intent.openDecisions.map(d => {
            const isDeciding = deciding?.nodeId === d.nodeId && deciding?.decisionId === d.id
            return (
              <div key={`${d.nodeId}:${d.id}`} className="artifact-row">
                <div className="artifact-content">
                  <span className="artifact-status open">?</span>
                  <span className="artifact-text">{d.question}</span>
                </div>
                <div className="attention-source">{d.nodeSummary}</div>
                {!isDeciding && (
                  <div className="artifact-actions">
                    <button
                      className="action-btn action-decide"
                      disabled={busy !== null}
                      onClick={() => { setDeciding({ nodeId: d.nodeId, decisionId: d.id }); setDecisionAnswer(''); setDecisionRationale('') }}
                    >
                      Answer
                    </button>
                  </div>
                )}
                {isDeciding && (
                  <div className="decision-form">
                    <input
                      className="decision-input"
                      type="text"
                      placeholder="Your decision..."
                      value={decisionAnswer}
                      onChange={e => setDecisionAnswer(e.target.value)}
                      autoFocus
                    />
                    <input
                      className="decision-input decision-rationale-input"
                      type="text"
                      placeholder="Rationale (optional)"
                      value={decisionRationale}
                      onChange={e => setDecisionRationale(e.target.value)}
                    />
                    <div className="decision-form-actions">
                      <button
                        className="action-btn action-decide"
                        disabled={busy !== null || !decisionAnswer.trim()}
                        onClick={() => act(d.nodeId, 'decisions', d.id, 'decide', {
                          answer: decisionAnswer.trim(),
                          rationale: decisionRationale.trim() || undefined,
                        })}
                      >
                        {isBusy(d.nodeId, 'decisions', d.id, 'decide') ? '...' : 'Decide'}
                      </button>
                      <button
                        className="action-btn action-cancel"
                        onClick={() => setDeciding(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Untested Assumptions */}
      {intent.untestedAssumptions.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">
            Assumptions ({intent.untestedAssumptions.length})
          </div>
          {intent.untestedAssumptions.map(a => (
            <div key={`${a.nodeId}:${a.id}`} className="artifact-row">
              <div className="artifact-content">
                <span className="artifact-status untested">○</span>
                <span className="artifact-text">{a.text}</span>
              </div>
              <div className="attention-source">{a.nodeSummary}</div>
              <div className="artifact-actions">
                <button
                  className="action-btn action-validate"
                  disabled={busy !== null}
                  onClick={() => act(a.nodeId, 'assumptions', a.id, 'validate')}
                >
                  {isBusy(a.nodeId, 'assumptions', a.id, 'validate') ? '...' : 'Validate'}
                </button>
                <button
                  className="action-btn action-reject"
                  disabled={busy !== null}
                  onClick={() => act(a.nodeId, 'assumptions', a.id, 'reject')}
                >
                  {isBusy(a.nodeId, 'assumptions', a.id, 'reject') ? '...' : 'Reject'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unscoped Edge Cases */}
      {intent.unscopedEdgeCases.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">
            Edge Cases ({intent.unscopedEdgeCases.length})
          </div>
          {intent.unscopedEdgeCases.map(e => (
            <div key={`${e.nodeId}:${e.id}`} className="artifact-row">
              <div className="artifact-content">
                <span className="artifact-status scope-unscoped">?</span>
                <span className="artifact-text">{e.case}</span>
              </div>
              <div className="attention-source">{e.nodeSummary}</div>
              <div className="artifact-actions">
                <button
                  className="action-btn action-scope-in"
                  disabled={busy !== null}
                  onClick={() => act(e.nodeId, 'edge_cases', e.id, 'scope_in')}
                >
                  {isBusy(e.nodeId, 'edge_cases', e.id, 'scope_in') ? '...' : 'In scope'}
                </button>
                <button
                  className="action-btn action-scope-out"
                  disabled={busy !== null}
                  onClick={() => act(e.nodeId, 'edge_cases', e.id, 'scope_out')}
                >
                  {isBusy(e.nodeId, 'edge_cases', e.id, 'scope_out') ? '...' : 'Out of scope'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unconfirmed Definition of Done */}
      {intent.unconfirmedDod.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">
            Definition of Done ({intent.unconfirmedDod.length})
          </div>
          {intent.unconfirmedDod.map(d => (
            <div key={`${d.nodeId}:${d.id}`} className="artifact-row">
              <div className="artifact-content">
                <span className="artifact-status untested">○</span>
                <span className="artifact-text">{d.criterion}</span>
              </div>
              <div className="attention-source">{d.nodeSummary}</div>
              <div className="artifact-actions">
                <button
                  className="action-btn action-validate"
                  disabled={busy !== null}
                  onClick={() => act(d.nodeId, 'definition_of_done', d.id, 'confirm')}
                >
                  {isBusy(d.nodeId, 'definition_of_done', d.id, 'confirm') ? '...' : 'Met'}
                </button>
                <button
                  className="action-btn action-reject"
                  disabled={busy !== null}
                  onClick={() => act(d.nodeId, 'definition_of_done', d.id, 'reject')}
                >
                  {isBusy(d.nodeId, 'definition_of_done', d.id, 'reject') ? '...' : 'Not met'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Blocked Nodes */}
      {intent.blockedNodes.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">Blocked ({intent.blockedNodes.length})</div>
          {intent.blockedNodes.map(n => (
            <div key={n.id} className="health-row">
              <span className="health-dot red" />
              <span className="health-label">{n.summary}</span>
              {n.reason && <span className="health-reason">{n.reason}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Stale Nodes */}
      {intent.staleNodes.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">Stale ({intent.staleNodes.length})</div>
          {intent.staleNodes.map(n => (
            <div key={n.id} className="health-row">
              <span className="health-dot orange" />
              <span className="health-label">{n.summary}</span>
              <span className="health-meta">{n.daysSince}d</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary when nothing needs attention */}
      {attentionCount === 0 && intent.blockedNodes.length === 0 && intent.staleNodes.length === 0 && (
        <div className="panel-section">
          <div className="panel-section-title">Status</div>
          <div className="panel-status-ok">All clear — no items need your attention</div>
        </div>
      )}
    </aside>
  )
}

// --- App ---

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getTheme)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [intents, setIntents] = useState<IntentSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('graph-ui-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }, [theme])

  // Set initial theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  // Data loading — extracted for reuse on mutation refresh
  const loadData = useCallback(async (isInitial = false) => {
    try {
      const projRes = await fetch('/api/projects')
      const projectsData: ProjectSummary[] = await projRes.json()
      setProjects(projectsData)

      const treeResponses: TreeApiResponse[] = await Promise.all(
        projectsData.map(p => fetch(`/api/projects/${p.project}/tree`).then(r => r.json()))
      )

      const allIntents: IntentSummary[] = []
      for (const resp of treeResponses) {
        const nodes = (resp.nodes || []).map(n => ({ ...n, project: resp.project }))
        const trees = buildTree(nodes)

        // Depth-1 nodes are direct children of project roots
        for (const root of trees) {
          for (const child of root.children || []) {
            if (!child.resolved) {
              allIntents.push(aggregateIntent(child, resp.project))
            }
          }
        }
      }

      // Sort: worst phase urgency, then attention count, then staleness
      allIntents.sort((a, b) => {
        const phaseA = phaseOrder(a.worstPhase)
        const phaseB = phaseOrder(b.worstPhase)
        if (phaseA !== phaseB) return phaseA - phaseB

        const attA = a.openDecisions.length + a.untestedAssumptions.length
          + a.unscopedEdgeCases.length + a.unconfirmedDod.length
        const attB = b.openDecisions.length + b.untestedAssumptions.length
          + b.unscopedEdgeCases.length + b.unconfirmedDod.length
        if (attB !== attA) return attB - attA

        return b.staleNodes.length - a.staleNodes.length
      })

      setIntents(allIntents)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      if (isInitial) setLoading(false)
    }
  }, [])

  useEffect(() => { loadData(true) }, [loadData])

  // Poll for changes — pauses when tab hidden or user inactive (60s)
  useEffect(() => {
    let lastKey = ''
    let timer: ReturnType<typeof setInterval> | null = null
    let lastActivity = Date.now()
    const POLL_MS = 2000
    const INACTIVE_MS = 60_000

    const poll = async () => {
      if (document.hidden) return
      if (Date.now() - lastActivity > INACTIVE_MS) return
      try {
        const res = await fetch('/api/changes')
        const { latest, count } = await res.json()
        const key = `${latest}:${count}`
        if (lastKey && key !== lastKey) {
          loadData()
        }
        lastKey = key
      } catch { /* ignore network errors */ }
    }

    const resetActivity = () => {
      const wasInactive = Date.now() - lastActivity > INACTIVE_MS
      lastActivity = Date.now()
      // If waking from inactivity, poll immediately to catch up
      if (wasInactive) poll()
    }

    const onVisibilityChange = () => {
      // Poll immediately when tab becomes visible again
      if (!document.hidden) poll()
    }

    timer = setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('mousemove', resetActivity)
    window.addEventListener('keydown', resetActivity)
    window.addEventListener('click', resetActivity)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('mousemove', resetActivity)
      window.removeEventListener('keydown', resetActivity)
      window.removeEventListener('click', resetActivity)
    }
  }, [loadData])

  const selectedIntent = intents.find(i => i.node.id === selectedId) || null

  if (loading) {
    return (
      <div className="app">
        <Header theme={theme} onToggleTheme={toggleTheme} projects={[]} />
        <div className="main">
          <div className="empty">
            <div className="empty-text">Loading...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Header theme={theme} onToggleTheme={toggleTheme} projects={projects} />
      <div className="main">
        <div className="intent-list">
          {intents.length === 0 ? (
            <div className="empty">
              <div className="empty-text">No active intents</div>
            </div>
          ) : (
            <>
              <div className="intent-controls">
                <span className="intent-count">{intents.length} intent{intents.length !== 1 ? 's' : ''}</span>
              </div>
              {intents.map(intent => (
                <IntentRow
                  key={intent.node.id}
                  intent={intent}
                  isSelected={intent.node.id === selectedId}
                  onClick={() => setSelectedId(intent.node.id === selectedId ? null : intent.node.id)}
                />
              ))}
            </>
          )}
        </div>
        <IntentDetailPanel intent={selectedIntent} onMutate={loadData} />
      </div>
    </div>
  )
}
