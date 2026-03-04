
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
