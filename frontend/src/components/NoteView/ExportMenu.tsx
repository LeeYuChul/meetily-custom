'use client';

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildExport, EXPORT_FORMATS, type ExportFormat, type ExportSource } from '@/lib/transcript-export';
import Analytics from '@/lib/analytics';

export function ExportMenu({ source }: { source: ExportSource }) {
  const [busy, setBusy] = useState(false);
  const empty = source.transcripts.length === 0;

  const handleExport = async (format: ExportFormat) => {
    setBusy(true);
    try {
      const { fileName, data } = await buildExport(format, source);
      const saved = await invoke<string | null>('save_export_file', {
        defaultName: fileName,
        data: Array.from(data),
      });
      if (saved) {
        toast.success('전사 기록을 내보냈습니다', { description: saved });
        Analytics.trackButtonClick(`export_transcript_${format}`, 'meeting_details');
      }
    } catch (e) {
      toast.error('내보내기에 실패했습니다', { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={empty || busy}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        title={empty ? '내보낼 전사 기록이 없습니다' : '전사 기록 내보내기'}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        내보내기
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-gray-500">음성 기록 내보내기</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EXPORT_FORMATS.map((f) => (
          <DropdownMenuItem key={f.value} onSelect={() => void handleExport(f.value)} className="flex-col items-start gap-0.5">
            <span className="text-sm font-medium">{f.label}</span>
            <span className="text-xs text-gray-500">{f.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
