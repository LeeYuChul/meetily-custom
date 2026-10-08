'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Switch } from './ui/switch';

interface SummaryInstruction {
  enabled: boolean;
  text: string;
}

const EXAMPLE = '예: 결정 사항과 담당자별 할 일을 표로 정리하고, 모든 내용은 한국어 존댓말로 작성해줘.';

/** Settings > 요약 모델: a global instruction applied to every AI summary when enabled */
export function SummaryInstructionSettings() {
  const [saved, setSaved] = useState<SummaryInstruction | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<SummaryInstruction>('summary_instruction_get')
      .then((value) => {
        setSaved(value);
        setEnabled(value.enabled);
        setText(value.text);
      })
      .catch((e) => {
        console.error('Failed to load summary instruction:', e);
        setSaved({ enabled: false, text: '' });
      });
  }, []);

  const persist = async (next: SummaryInstruction, message: string) => {
    setSaving(true);
    try {
      await invoke('summary_instruction_set', { enabled: next.enabled, text: next.text });
      setSaved(next);
      toast.success(message);
    } catch (e) {
      toast.error('요약 지침을 저장하지 못했습니다', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  // The toggle takes effect immediately; text edits are saved with the button
  const handleToggle = (value: boolean) => {
    setEnabled(value);
    void persist({ enabled: value, text: saved?.text ?? text }, value ? '요약 지침을 켰습니다' : '요약 지침을 껐습니다');
  };

  const dirty = saved !== null && text !== saved.text;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">요약 지침 (Instruction)</h3>
          <p className="text-sm text-gray-600">
            켜 두면 모든 AI 요약을 만들 때 아래 지침이 자동으로 적용됩니다.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} disabled={saved === null || saving} />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        rows={6}
        disabled={saved === null}
        className={`mt-4 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-note-green focus:outline-none focus:ring-2 focus:ring-note-green/20 ${
          enabled ? 'bg-white' : 'bg-gray-50 text-gray-500'
        }`}
      />

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {enabled
            ? text.trim()
              ? '지침이 적용되고 있습니다. 노트별 “AI 요약 참고 내용”과 함께 사용됩니다.'
              : '지침이 비어 있어 적용할 내용이 없습니다.'
            : '꺼져 있어 지침이 적용되지 않습니다.'}
        </p>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void persist({ enabled, text }, '요약 지침을 저장했습니다')}
          className="rounded-lg bg-note-green px-4 py-2 text-sm font-medium text-white hover:bg-note-green-dark disabled:opacity-40"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
