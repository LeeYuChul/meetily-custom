'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Pencil, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { Transcript } from '@/types';
import { formatDurationKo, formatNoteDate, orderedSpeakers } from '@/lib/speakers';
import { ExportMenu } from './ExportMenu';

interface NoteHeaderProps {
  meetingId: string;
  title: string;
  createdAt?: string;
  transcripts: Transcript[];
  onTitleSaved: (title: string) => void;
  summaryOpen: boolean;
  onToggleSummary: () => void;
}

export function NoteHeader({ meetingId, title, createdAt, transcripts, onTitleSaved, summaryOpen, onToggleSummary }: NoteHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => setDraft(title), [title]);

  const duration = transcripts.reduce((max, t) => Math.max(max, t.audio_end_time ?? 0), 0);
  const speakerCount = orderedSpeakers(transcripts).length;

  const saveTitle = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title) {
      setDraft(title);
      return;
    }
    try {
      await invoke('api_save_meeting_title', { meetingId, title: next });
      onTitleSaved(next);
    } catch (e) {
      setDraft(title);
      toast.error('제목을 저장하지 못했습니다', { description: String(e) });
    }
  };

  return (
    <header className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-note-line bg-white px-6 pb-3 pt-5">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveTitle();
              if (e.key === 'Escape') {
                setDraft(title);
                setEditing(false);
              }
            }}
            className="w-full rounded-md border border-note-green px-2 py-0.5 text-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-note-green/30"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex max-w-full items-center gap-2 rounded-md px-2 py-0.5 -mx-2 text-left hover:bg-gray-50"
            title="제목 변경"
          >
            <h1 className="truncate text-xl font-bold text-gray-900">{title}</h1>
            <Pencil className="h-4 w-4 flex-shrink-0 text-gray-300 group-hover:text-gray-500" />
          </button>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {[
            formatNoteDate(createdAt),
            duration > 0 ? formatDurationKo(duration) : '',
            speakerCount > 0 ? `참석자 ${speakerCount}명` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 pt-1">
        <ExportMenu source={{ title, createdAt, durationSeconds: duration, transcripts }} />
        <button
          type="button"
          onClick={onToggleSummary}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            summaryOpen ? 'border-note-green bg-note-mint text-gray-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
          title={summaryOpen ? 'AI 요약 닫기' : 'AI 요약 열기'}
        >
          {summaryOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          AI 요약
        </button>
      </div>
    </header>
  );
}
