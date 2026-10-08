'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Transcript } from '@/types';
import { formatClock, speakerColor, speakerInitial } from '@/lib/speakers';

export type RenameScope = 'this' | 'all' | 'after' | 'before';

const SCOPES: { value: RenameScope; label: string; hint: string }[] = [
  { value: 'this', label: '이 부분만 적용', hint: '선택한 문단 하나만 변경합니다' },
  { value: 'all', label: '전체 적용', hint: '같은 참석자의 모든 문단을 변경합니다' },
  { value: 'after', label: '이 구간 이후부터 적용', hint: '선택한 문단부터 끝까지 변경합니다' },
  { value: 'before', label: '이 구간 이전까지 적용', hint: '처음부터 선택한 문단까지 변경합니다' },
];

interface SpeakerRenameDialogProps {
  meetingId: string;
  target: Transcript | null;
  speakers: string[];
  onClose: () => void;
  onRenamed: () => Promise<void> | void;
}

export function SpeakerRenameDialog({ meetingId, target, speakers, onClose, onRenamed }: SpeakerRenameDialogProps) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<RenameScope>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.speaker ?? '');
      // Without diarization every row is unlabeled, so "all" would rename the whole note
      setScope(target.speaker ? 'all' : 'this');
    }
  }, [target]);

  const current = target?.speaker ?? null;
  const trimmed = name.trim();
  const otherSpeakers = speakers.filter((s) => s !== current);

  const handleApply = async () => {
    if (!target || !trimmed) return;
    setSaving(true);
    try {
      const updated = await invoke<number>('rename_speaker', {
        meetingId,
        transcriptId: target.id,
        newName: trimmed,
        scope,
      });
      toast.success(`참석자 이름을 '${trimmed}'(으)로 변경했습니다`, { description: `${updated}개 문단에 적용` });
      await onRenamed();
      onClose();
    } catch (e) {
      toast.error('참석자 이름을 변경하지 못했습니다', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>참석자 이름 변경</DialogTitle>
          <DialogDescription>
            {target && (
              <>
                {formatClock(target.audio_start_time)} · {current ?? '참석자 미지정'}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleApply();
            }}
            placeholder="참석자 이름을 입력하세요"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-note-green focus:outline-none focus:ring-2 focus:ring-note-green/30"
          />

          {otherSpeakers.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-gray-500">기존 참석자로 지정</p>
              <div className="flex flex-wrap gap-1.5">
                {otherSpeakers.map((s) => {
                  const color = speakerColor(s, speakers);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setName(s)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        trimmed === s ? 'border-note-green bg-note-mint text-gray-900' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                        style={{ backgroundColor: color.bg }}
                      >
                        {speakerInitial(s)}
                      </span>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div role="radiogroup" aria-label="적용 범위" className="space-y-1.5">
            <p className="text-xs text-gray-500">적용 범위</p>
            {SCOPES.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
                  scope === option.value ? 'border-note-green bg-note-mint' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="rename-scope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                  className="mt-0.5 accent-[#03C75A]"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                  <span className="block text-xs text-gray-500">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!trimmed || saving}
            onClick={handleApply}
            className="rounded-lg bg-note-green px-4 py-2 text-sm font-medium text-white hover:bg-note-green-dark disabled:opacity-50"
          >
            {saving ? '적용 중...' : '적용'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
