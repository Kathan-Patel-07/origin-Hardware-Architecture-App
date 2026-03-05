
// GitHub API service — token is stored in memory only (never persisted)
const DATA_REPO = 'Kathan-Patel-07/Origin-Hardware-Architecture';
const API_BASE = 'https://api.github.com';

let _token: string | null = null;

export function setToken(token: string) {
  _token = token.trim() || null;
}

export function getToken(): string | null {
  return _token;
}

export function clearToken() {
  _token = null;
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
  subsystems: string[]; // e.g. ["moma", "mapper", "sander", "sprayer", "opStation"]
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
  notes?: string;
  flagged?: boolean;
  id?: string;
  [key: string]: unknown;
}

export interface SubsystemJSON {
  name: string;
  key: string; // e.g. "moma"
  connections: SubsystemConnection[];
  [key: string]: unknown;
}

export async function getSubsystem(name: string, branch: string): Promise<SubsystemJSON> {
  const file = await getFile(`subsystems/${name}.json`, branch);
  return JSON.parse(file.content) as SubsystemJSON;
}

// Default subsystem keys if robot.json is missing
const DEFAULT_SUBSYSTEMS = ['moma', 'mapper', 'sander', 'sprayer', 'opStation'];

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

export async function loadAllCatalogItems(branch: string): Promise<CatalogItem[]> {
  const entries = await listDirectory('catalog', branch);
  const jsonFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
  const results = await Promise.allSettled(
    jsonFiles.map((e) => getFile(`catalog/${e.name}`, branch).then((f) => JSON.parse(f.content) as CatalogItem))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<CatalogItem> => r.status === 'fulfilled')
    .map((r) => r.value);
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

// ── Subsystem data ────────────────────────────────────────────────────────────

export async function loadAllSubsystems(
  branch: string,
  subsystemKeys?: string[]
): Promise<{ subsystems: SubsystemJSON[]; errors: Record<string, string> }> {
  const keys = subsystemKeys ?? DEFAULT_SUBSYSTEMS;
  const results = await Promise.allSettled(
    keys.map((k) => getSubsystem(k, branch))
  );

  const subsystems: SubsystemJSON[] = [];
  const errors: Record<string, string> = {};

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      subsystems.push(result.value);
    } else {
      errors[keys[i]] = result.reason?.message ?? 'Unknown error';
    }
  });

  return { subsystems, errors };
}
