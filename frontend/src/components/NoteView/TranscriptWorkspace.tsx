'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, FolderOpen, RefreshCw, Users } from 'lucide-react';
import type { Transcript } from '@/types';
import { useMeetingAudio } from '@/hooks/useMeetingAudio';
import { orderedSpeakers, speakerColor, speakerInitial } from '@/lib/speakers';
import { TranscriptList } from './TranscriptList';
import { PlayerBar } from './PlayerBar';
import { SpeakerRenameDialog } from './SpeakerRenameDialog';
import { SpeakerDetectDialog } from './SpeakerDetectDialog';
import { RetranscribeDialog } from '@/components/MeetingDetails/RetranscribeDialog';

interface TranscriptWorkspaceProps {
  meetingId: string;
  meetingFolderPath?: string | null;
  transcripts: Transcript[];
  onRefetch: () => Promise<void>;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
}

/** Elements that handle Space/arrow keys themselves (typing, buttons, menus, the seek slider, dialogs) */
const KEYBOARD_OWNERS =
  'input, textarea, select, button, a, [role="button"], [role="slider"], [role^="menu"], [role="listbox"], ' +
  '[role="combobox"], [aria-haspopup], [role="dialog"], [role="alertdialog"]';

function ownsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest(KEYBOARD_OWNERS);
}

export function TranscriptWorkspace({
  meetingId,
  meetingFolderPath,
  transcripts,
  onRefetch,
  onCopyTranscript,
  onOpenMeetingFolder,
}: TranscriptWorkspaceProps) {
  const audio = useMeetingAudio(meetingId);
  const [follow, setFollow] = useState(true);
  const [renameTarget, setRenameTarget] = useState<Transcript | null>(null);
  const [showDetect, setShowDetect] = useState(false);
  const [showRetranscribe, setShowRetranscribe] = useState(false);

  const sorted = useMemo(
    () => [...transcripts].sort((a, b) => (a.audio_start_time ?? 0) - (b.audio_start_time ?? 0)),
    [transcripts],
  );
  const speakers = useMemo(() => orderedSpeakers(sorted), [sorted]);
  const speakingTime = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of sorted) {
      if (!t.speaker) continue;
      totals.set(t.speaker, (totals.get(t.speaker) ?? 0) + ((t.audio_end_time ?? 0) - (t.audio_start_time ?? 0)));
    }
    const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0) || 1;
    return new Map(Array.from(totals, ([k, v]) => [k, Math.round((v / sum) * 100)]));
  }, [sorted]);

  const canPlay = audio.status === 'ready';
  const { seek, toggle, skip } = audio;

  const handleSeek = useCallback(
    (time: number, autoplay: boolean) => {
      setFollow(true);
      seek(time, autoplay);
    },
    [seek],
  );

  // Space: play/pause, ←/→: 5s skip (ignored while typing or in dialogs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canPlay || e.defaultPrevented || ownsKeyboard(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        skip(-5);
      } else if (e.key === 'ArrowRight') {
        skip(5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPlay, toggle, skip]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Section header */}
      <div className="flex-shrink-0 border-b border-note-line">
        <div className="flex items-center gap-2 px-6 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">음성 기록</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowDetect(true)}
              disabled={!meetingFolderPath || sorted.length === 0}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              title="음성을 분석해 참석자를 구분합니다"
            >
              <Users className="h-4 w-4" />
              화자 구분
            </button>
            {meetingFolderPath && (
              <button
                type="button"
                onClick={() => setShowRetranscribe(true)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                title="다른 모델이나 언어로 다시 전사합니다"
              >
                <RefreshCw className="h-4 w-4" />
                다시 전사
              </button>
            )}
            <button
              type="button"
              onClick={onCopyTranscript}
              disabled={sorted.length === 0}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
              title="전사 기록 복사"
              aria-label="전사 기록 복사"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void onOpenMeetingFolder()}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              title="노트 폴더 열기"
              aria-label="노트 폴더 열기"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </div>
        {speakers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-6 pb-3">
            {speakers.map((s) => {
              const color = speakerColor(s, speakers);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRenameTarget(sorted.find((t) => t.speaker === s) ?? null)}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs text-gray-700 hover:brightness-95"
                  style={{ backgroundColor: color.soft }}
                  title="참석자 이름 변경"
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: color.bg }}
                  >
                    {speakerInitial(s)}
                  </span>
                  {s}
                  <span className="text-gray-400">{speakingTime.get(s) ?? 0}%</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">전사된 음성 기록이 없습니다</div>
        ) : (
          <TranscriptList
            transcripts={sorted}
            speakers={speakers}
            currentTime={audio.currentTime}
            isPlaying={audio.isPlaying}
            canPlay={canPlay}
            follow={follow}
            onUserScroll={() => audio.isPlaying && setFollow(false)}
            onSeek={handleSeek}
            onRenameSpeaker={setRenameTarget}
          />
        )}
      </div>

      <PlayerBar audio={audio} transcripts={sorted} speakers={speakers} follow={follow} onFollow={() => setFollow(true)} />

      <SpeakerRenameDialog
        meetingId={meetingId}
        target={renameTarget}
        speakers={speakers}
        onClose={() => setRenameTarget(null)}
        onRenamed={onRefetch}
      />
      <SpeakerDetectDialog
        open={showDetect}
        onOpenChange={setShowDetect}
        meetingId={meetingId}
        hasSpeakers={speakers.length > 0}
        onComplete={onRefetch}
      />
      {meetingFolderPath && (
        <RetranscribeDialog
          open={showRetranscribe}
          onOpenChange={setShowRetranscribe}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onComplete={onRefetch}
        />
      )}
    </div>
  );
}
