
import React, { useState, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import { listDirectory, getFile } from '../services/github';

interface PcbReviewViewerProps {
  branch: string;
}

interface ReviewFile {
  name: string;
  title: string;
}

// Severity counts parsed from a report body for the list badges
const countMatches = (text: string, re: RegExp) => (text.match(re) ?? []).length;

export const PcbReviewViewer: React.FC<PcbReviewViewerProps> = ({ branch }) => {
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingList(true);
    setError(null);
    listDirectory('pcb-reviews', branch)
      .then((entries) => {
        if (cancelled) return;
        const mdFiles = entries
          .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
          .map((e) => ({
            name: e.name,
            title: e.name.replace(/^review-/, '').replace(/\.md$/, '').replace(/[-_]/g, ' '),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setFiles(mdFiles);
        if (mdFiles.length > 0) setSelected(mdFiles[0].name);
      })
      .catch((e: any) => {
        if (cancelled) return;
        // 404 just means no reviews committed yet — show empty state, not an error
        if (String(e.message).toLowerCase().includes('not found')) setFiles([]);
        else setError(e.message || 'Failed to list reviews.');
      })
      .finally(() => { if (!cancelled) setIsLoadingList(false); });
    return () => { cancelled = true; };
  }, [branch]);

  useEffect(() => {
    if (!selected) { setContent(''); return; }
    let cancelled = false;
    setIsLoadingFile(true);
    getFile(`pcb-reviews/${selected}`, branch)
      .then((f) => { if (!cancelled) setContent(f.content); })
      .catch((e: any) => { if (!cancelled) setError(e.message || 'Failed to load review.'); })
      .finally(() => { if (!cancelled) setIsLoadingFile(false); });
    return () => { cancelled = true; };
  }, [selected, branch]);

  const html = useMemo(() => (content ? (marked.parse(content) as string) : ''), [content]);

  const severity = useMemo(() => ({
    fail: countMatches(content, /^.*\bFAIL\b/gm),
    warn: countMatches(content, /^.*\bWARN\b/gm),
  }), [content]);

  if (isLoadingList) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
        <p className="text-sm">Loading PCB reviews…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-red-600 bg-red-50 p-3 rounded border border-red-100">{error}</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 px-8">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
          <rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/>
        </svg>
        <div className="text-center max-w-md">
          <p className="font-semibold text-slate-500">No PCB reviews on this branch</p>
          <p className="text-sm mt-1">
            Reviews are generated with the <code className="bg-slate-100 px-1 rounded text-xs">/pcb-review</code> pipeline in Claude Code
            and committed to <code className="bg-slate-100 px-1 rounded text-xs">pcb-reviews/</code> in this repo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Review list */}
      <div className="w-64 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-slate-100">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Board Reviews</span>
        </div>
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => setSelected(f.name)}
            className={`w-full text-left px-4 py-2.5 text-sm border-b border-slate-50 transition-colors capitalize ${
              selected === f.name ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.title}
          </button>
        ))}
      </div>

      {/* Report body */}
      <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
        {isLoadingFile ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2 text-sm">
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
            Loading report…
          </div>
        ) : (
          <div className="max-w-4xl mx-auto bg-white shadow-sm border border-slate-200 rounded-xl p-10">
            {(severity.fail > 0 || severity.warn > 0) && (
              <div className="flex gap-2 mb-6">
                {severity.fail > 0 && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                    {severity.fail} FAIL
                  </span>
                )}
                {severity.warn > 0 && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                    {severity.warn} WARN
                  </span>
                )}
              </div>
            )}
            <div
              className="prose prose-slate prose-sm max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h2:border-b prose-h2:border-slate-200 prose-h2:pb-2 prose-code:bg-slate-100 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-table:text-xs"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
