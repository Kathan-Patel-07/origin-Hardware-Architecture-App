
// GitHub API service — token is stored in memory only (never persisted)
const DATA_REPO = 'Kathan-Patel-07/Origin-Hardware-Architecture';
const API_BASE = 'https://api.github.com';

// Window object survives Vite HMR module reloads (unlike module-level vars).
// The PAT is never written to localStorage or disk — only held in memory/window.
let _token: string | null = (window as any).__origin_gh_pat ?? null;

export function setToken(token: string) {
  _token = token.trim() || null;
  (window as any).__origin_gh_pat = _token;
}

export function getToken(): string | null {
  return _token;
}

export function clearToken() {
  _token = null;
  (window as any).__origin_gh_pat = null;
}

function headers(): HeadersInit {
  if (!_token) throw new Error('GitHub token not set');
  return {
    Authorization: `Bearer ${_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ── Branch listing ──────────────────────────────────────────────────────────

export interface BranchInfo {
  name: string;
  commit: { sha: string };
}

export async function listBranches(): Promise<BranchInfo[]> {
  const all: BranchInfo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${API_BASE}/repos/${DATA_REPO}/branches?per_page=100&page=${page}`,
      { headers: headers() }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error ${res.status}`);
    }
    const batch: BranchInfo[] = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

// ── File content ─────────────────────────────────────────────────────────────

export interface FileContent {
  content: string; // decoded UTF-8 string
  sha: string;     // blob SHA — needed for PUT updates
  path: string;
}

export async function getFile(path: string, branch: string): Promise<FileContent> {
  const res = await fetch(
    `${API_BASE}/repos/${DATA_REPO}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: headers() }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }
  const data = await res.json();
  const decoded = atob(data.content.replace(/\n/g, ''));
  return { content: decoded, sha: data.sha, path: data.path };
}

// ── Robot metadata ───────────────────────────────────────────────────────────

export interface RobotMeta {
  name: string;
  type: 'robot' | 'tool' | string;
  version?: string;
  subsystems: string[];
  subsystemLabels?: Record<string, string>;
  [key: string]: unknown;
}

export async function getRobotMeta(branch: string): Promise<RobotMeta> {
  const file = await getFile('robot.json', branch);
  return JSON.parse(file.content) as RobotMeta;
}

// ── Assembly status ───────────────────────────────────────────────────────────

export interface AssemblyDeviation {
  field: string;
  idealValue: string;
  actualValue: string;
  reason: string;
}

export interface AssemblyConnectionStatus {
  status: 'pending' | 'assembled' | 'assembled_with_deviation';
  assembledAt?: string;
  deviation?: AssemblyDeviation;
  cableLength?: string;
}

export interface AssemblyStatusFile {
  branch: string;
  updatedAt: string;
  connections: Record<string, AssemblyConnectionStatus>;
}

export async function getAssemblyStatus(branch: string): Promise<AssemblyStatusFile> {
  try {
    const file = await getFile('assembly_status.json', branch);
    return JSON.parse(file.content) as AssemblyStatusFile;
  } catch {
    return { branch, updatedAt: new Date().toISOString(), connections: {} };
  }
}

/** Returns the status file AND the current blob SHA (null if file doesn't exist yet). */
export async function loadAssemblyStatus(
  branch: string
): Promise<{ status: AssemblyStatusFile; sha: string | null }> {
  try {
    const file = await getFile('assembly_status.json', branch);
    return { status: JSON.parse(file.content) as AssemblyStatusFile, sha: file.sha };
  } catch {
    return { status: { branch, updatedAt: new Date().toISOString(), connections: {} }, sha: null };
  }
}

export interface ComponentPlacementStatus {
  placed: boolean;
  placedAt?: string;
}

export interface AssemblyFile {
  assemblyId: string;
  updatedAt: string;
  connections: Record<string, AssemblyConnectionStatus>;
  components: Record<string, ComponentPlacementStatus>;
}

/** Loads assembly/{assemblyId}.json from the branch. Returns empty file if not found. */
export async function loadAssemblyFile(
  assemblyId: string,
  branch: string
): Promise<{ file: AssemblyFile; sha: string | null }> {
  try {
    const f = await getFile(`assembly/${assemblyId}.json`, branch);
    return { file: JSON.parse(f.content) as AssemblyFile, sha: f.sha };
  } catch {
    return {
      file: { assemblyId, updatedAt: new Date().toISOString(), connections: {}, components: {} },
      sha: null,
    };
  }
}

// ── Subsystem data ────────────────────────────────────────────────────────────

export interface SubsystemConnection {
  source: string;
  sourcePartName?: string;
  sourceDatasheet?: string;
  sourcePurchaseLink?: string;
  destination: string;
  destPartName?: string;
  destDatasheet?: string;
  destPurchaseLink?: string;
  architectureType: string;
  wireName: string;
  wireSpec: string;
  functionalGroup: string;
  sourceCompartment: string;
  destCompartment: string;
  averagePower?: string;
  maxContinuousPower?: string;
  peakPower?: string;
  peakPowerTransientTime?: string;
  powerDirection?: string;
  voltage?: string;
  notes?: string;
  flagged?: boolean;
  id?: string;
  [key: string]: unknown;
}

export interface SubsystemJSON {
  name: string;
  key: string;
  connections: SubsystemConnection[];
  [key: string]: unknown;
}

// Default subsystem keys matching the normalized schema
export const DEFAULT_SUBSYSTEMS = [
  'moma',
  'handheld_mapper',
  'tools_sander',
  'tools_sprayer',
  'operation_station',
];

// Raw shape of a connection entry in connections/{sub}.json
interface NormalizedConn {
  id: string;
  source: string;
  destination: string;
  architectureType?: string;
  wireName?: string;
  wireSpec?: string;
  functionalGroup?: string;
  maxContinuousPower?: string;
  averagePower?: string;
  peakPower?: string;
  peakPowerTransientTime?: string;
  powerDirection?: string;
  voltage?: string;
  notes?: string;
  flagged?: boolean;
  flagReason?: string;
  [key: string]: unknown;
}

// Loads one subsystem from connections/ + nodes/ + catalog lookup
async function loadSubsystemNormalized(
  key: string,
  branch: string,
  nodesMap: Record<string, NodeEntry[]>,
  catalogMap: Map<string, CatalogItem>,
  labelMap: Record<string, string>
): Promise<SubsystemJSON> {
  const file = await getFile(`connections/${key}.json`, branch);
  const conns: NormalizedConn[] = JSON.parse(file.content);
  const nodes: NodeEntry[] = nodesMap[key] ?? [];

  const nodeById = new Map<string, NodeEntry>(nodes.map((n) => [n.nodeId, n]));

  const connections: SubsystemConnection[] = conns.map((c) => {
    const srcNode = nodeById.get(c.source);
    const dstNode = nodeById.get(c.destination);
    const srcCat = srcNode?.catalogRef ? catalogMap.get(srcNode.catalogRef) : undefined;
    const dstCat = dstNode?.catalogRef ? catalogMap.get(dstNode.catalogRef) : undefined;

    return {
      id: c.id,
      source: c.source,
      sourcePartName: srcCat?.partName,
      sourceDatasheet: srcCat?.datasheetUrl,
      sourcePurchaseLink: srcCat?.purchaseLink,
      destination: c.destination,
      destPartName: dstCat?.partName,
      destDatasheet: dstCat?.datasheetUrl,
      destPurchaseLink: dstCat?.purchaseLink,
      architectureType: c.architectureType ?? '',
      wireName: c.wireName ?? '',
      wireSpec: c.wireSpec ?? '',
      functionalGroup: c.functionalGroup ?? '',
      sourceCompartment: srcNode?.compartment ?? '',
      destCompartment: dstNode?.compartment ?? '',
      averagePower: c.averagePower,
      maxContinuousPower: c.maxContinuousPower,
      peakPower: c.peakPower,
      peakPowerTransientTime: c.peakPowerTransientTime,
      powerDirection: c.powerDirection,
      voltage: c.voltage,
      notes: c.notes,
      flagged: c.flagged ?? (srcNode?.flagged === true),
    };
  });

  return { key, name: labelMap[key] ?? key, connections };
}

export async function loadAllSubsystems(
  branch: string,
  subsystemKeys?: string[],
  labelMap?: Record<string, string>
): Promise<{ subsystems: SubsystemJSON[]; errors: Record<string, string> }> {
  const keys = subsystemKeys ?? DEFAULT_SUBSYSTEMS;
  const labels = labelMap ?? {};

  // Load catalog and nodes in parallel before fetching connection files
  const [catalogResult, nodesResult] = await Promise.allSettled([
    loadAllCatalogItems(branch),
    loadAllNodes(branch, keys),
  ]);

  const catalogMap = new Map<string, CatalogItem>();
  if (catalogResult.status === 'fulfilled') {
    for (const item of catalogResult.value.items) {
      catalogMap.set(item.partId, item);
    }
  }

  const nodesMap: Record<string, NodeEntry[]> =
    nodesResult.status === 'fulfilled' ? nodesResult.value : {};

  const results = await Promise.allSettled(
    keys.map((k) => loadSubsystemNormalized(k, branch, nodesMap, catalogMap, labels))
  );

  const subsystems: SubsystemJSON[] = [];
  const errors: Record<string, string> = {};

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      subsystems.push(result.value);
    } else {
      errors[keys[i]] = (result.reason as Error)?.message ?? 'Unknown error';
    }
  });

  return { subsystems, errors };
}

// ── Write operations ──────────────────────────────────────────────────────────

export async function createBranch(branchName: string, fromBranch: string): Promise<void> {
  // Get the current HEAD SHA of the source branch
  const refRes = await fetch(
    `${API_BASE}/repos/${DATA_REPO}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
    { headers: headers() }
  );
  if (!refRes.ok) {
    const err = await refRes.json().catch(() => ({}));
    throw new Error(err.message || `Could not find branch "${fromBranch}"`);
  }
  const refData = await refRes.json();
  const sha: string = refData.object.sha;

  const res = await fetch(`${API_BASE}/repos/${DATA_REPO}/git/refs`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Failed to create branch "${branchName}"`);
  }
}

function toBase64(str: string): string {
  // Handles UTF-8 content correctly
  return btoa(unescape(encodeURIComponent(str)));
}

export async function commitFile(
  path: string,
  content: string,
  message: string,
  branch: string,
  sha: string | null // blob SHA of the existing file; null for new files
): Promise<void> {
  const body: Record<string, unknown> = { message, content: toBase64(content), branch };
  if (sha) body.sha = sha;
  const res = await fetch(`${API_BASE}/repos/${DATA_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Failed to commit ${path}`);
  }
}

export interface PullRequest {
  number: number;
  html_url: string;
  title: string;
}

export async function deleteFile(
  path: string,
  sha: string,
  message: string,
  branch: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${DATA_REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Failed to delete ${path}`);
  }
}

export async function createPR(
  title: string,
  body: string,
  head: string,
  base: string
): Promise<PullRequest> {
  const res = await fetch(`${API_BASE}/repos/${DATA_REPO}/pulls`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create pull request');
  }
  return res.json();
}

// ── Catalog + Nodes ───────────────────────────────────────────────────────────

export interface CatalogItem {
  partId: string;
  partName: string;
  datasheetUrl?: string;
  purchaseLink?: string;
  maxContinuousPower?: string;
  averagePower?: string;
  peakPower?: string;
  category?: string;
  specRef?: string;
  inStock?: boolean;
  usedAs?: string[];
}

export interface NodeEntry {
  nodeId: string;
  catalogRef: string;
  compartment: string;
  subsystem: string;
  flagged?: boolean;
}

export interface DirectoryEntry {
  name: string;
  type: 'file' | 'dir' | string;
}

export async function listDirectory(path: string, branch: string): Promise<DirectoryEntry[]> {
  const res = await fetch(
    `${API_BASE}/repos/${DATA_REPO}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: headers() }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }
  return res.json() as Promise<DirectoryEntry[]>;
}

export async function loadAllCatalogItems(
  branch: string
): Promise<{ items: CatalogItem[]; shas: Record<string, string> }> {
  const entries = await listDirectory('catalog', branch);
  const jsonFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
  const results = await Promise.allSettled(
    jsonFiles.map((e) =>
      getFile(`catalog/${e.name}`, branch).then((f) => ({
        item: JSON.parse(f.content) as CatalogItem,
        sha: f.sha,
      }))
    )
  );
  const items: CatalogItem[] = [];
  const shas: Record<string, string> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      items.push(r.value.item);
      shas[r.value.item.partId] = r.value.sha;
    }
  }
  return { items, shas };
}

export async function loadAllNodes(
  branch: string,
  subsystemKeys: string[]
): Promise<Record<string, NodeEntry[]>> {
  const results = await Promise.allSettled(
    subsystemKeys.map((k) => getFile(`nodes/${k}.json`, branch).then((f) => JSON.parse(f.content) as NodeEntry[]))
  );
  const out: Record<string, NodeEntry[]> = {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      out[subsystemKeys[i]] = result.value;
    }
  });
  return out;
}

/** Loads nodes/{key}.json and returns entries + blob SHA. Returns empty array + null SHA if not found. */
export async function loadNodesFile(
  key: string,
  branch: string
): Promise<{ entries: NodeEntry[]; sha: string | null }> {
  try {
    const f = await getFile(`nodes/${key}.json`, branch);
    return { entries: JSON.parse(f.content) as NodeEntry[], sha: f.sha };
  } catch {
    return { entries: [], sha: null };
  }
}


// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InventoryFileEntry {
  qtyPerRobot: number;
  qtyInStock: number;
  purchaseStatus: string;
  comment: string;
}

/** Loads inventory/inventory.json from the branch. Returns empty object + null SHA if not found. */
export async function loadInventoryFile(
  branch: string
): Promise<{ data: Record<string, InventoryFileEntry>; sha: string | null }> {
  try {
    const f = await getFile('inventory/inventory.json', branch);
    return { data: JSON.parse(f.content) as Record<string, InventoryFileEntry>, sha: f.sha };
  } catch {
    return { data: {}, sha: null };
  }
}
