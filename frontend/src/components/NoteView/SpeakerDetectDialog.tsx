'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SpeakerCountSelect } from './SpeakerCountSelect';

interface SpeakerDetectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  hasSpeakers: boolean;
  onComplete: () => Promise<void> | void;
}

interface DiarizationProgress {
  meeting_id: string;
  progress: number;
  message: string;
}

/** Re-runs speaker detection on an existing note without re-transcribing */
export function SpeakerDetectDialog({ open, onOpenChange, meetingId, hasSpeakers, onComplete }: SpeakerDetectDialogProps) {
  const [count, setCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DiarizationProgress | null>(null);

  useEffect(() => {
    if (!running) return;
    const unlisten = listen<DiarizationProgress>('diarization-progress', (e) => {
      if (e.payload.meeting_id === meetingId) setProgress(e.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [running, meetingId]);

  const handleRun = async () => {
    setRunning(true);
    setProgress(null);
    try {
      const result = await invoke<{ speakers: number; updated: number }>('diarize_meeting', {
        meetingId,
        numSpeakers: count,
      });
      toast.success(`참석자 ${result.speakers}명을 구분했습니다`);
      await onComplete();
      onOpenChange(false);
    } catch (e) {
      toast.error('화자 구분에 실패했습니다', { description: String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>화자 구분</DialogTitle>
          <DialogDescription>
            음성을 분석해 문단마다 참석자를 다시 지정합니다.
            {hasSpeakers && ' 기존에 변경한 참석자 이름은 초기화됩니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">참석자 수</p>
            <p className="text-xs text-gray-500">알고 있다면 지정하면 더 정확합니다</p>
          </div>
          <SpeakerCountSelect value={count} onChange={setCount} disabled={running} />
        </div>

        {running && (
          <div className="space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-note-green transition-[width] duration-300"
                style={{ width: `${progress?.progress ?? 2}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {progress?.message?.startsWith('Downloading') ? '화자 구분 모델을 내려받는 중...' : '참석자 음성을 분석하는 중...'}
            </p>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            disabled={running}
            onClick={() => onOpenChange(false)}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={running}
            onClick={handleRun}
            className="rounded-lg bg-note-green px-4 py-2 text-sm font-medium text-white hover:bg-note-green-dark disabled:opacity-50"
          >
            {running ? '분석 중...' : '화자 구분 시작'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
