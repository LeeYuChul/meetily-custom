import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Upload,
  Globe,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Cpu,
  FileAudio,
  Clock,
  HardDrive,
  ChevronDown,
  ChevronUp,
  Users,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { useImportAudio, ImportResult } from '@/hooks/useImportAudio';
import { useRouter } from 'next/navigation';
import { useSidebar } from '../Sidebar/SidebarProvider';
import { LANGUAGES } from '@/constants/languages';
import { useTranscriptionModels, ModelOption } from '@/hooks/useTranscriptionModels';
import { SpeakerCountSelect } from '@/components/NoteView/SpeakerCountSelect';
import { stageLabel } from '@/lib/import-stages';

const IMPORT_LANGUAGE_KEY = 'meetily.import.language';

/** Last language used for uploads; Korean by default since auto-detect costs an extra pass */
function initialImportLanguage(): string {
  try {
    return localStorage.getItem(IMPORT_LANGUAGE_KEY) || 'ko';
  } catch {
    return 'ko';
  }
}


interface ImportAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedFile?: string | null;
  onComplete?: () => void;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ImportAudioDialog({
  open,
  onOpenChange,
  preselectedFile,
  onComplete,
}: ImportAudioDialogProps) {
  const router = useRouter();
  const { refetchMeetings } = useSidebar();
  const { selectedLanguage, transcriptModelConfig } = useConfig();

  const [title, setTitle] = useState('');
  const [selectedLang, setSelectedLang] = useState(initialImportLanguage);
  const [diarize, setDiarize] = useState(true);
  const [speakerCount, setSpeakerCount] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [titleModifiedByUser, setTitleModifiedByUser] = useState(false);

  // Always start as false — represents "dialog has not yet been opened".
  // Do NOT initialize from the `open` prop: if the component mounts with open=true
  // (e.g. drag-drop path), we still need the initialization effect to run.
  const prevOpenRef = useRef(false);

  // Use centralized model fetching hook
  const {
    availableModels,
    selectedModelKey,
    setSelectedModelKey,
    loadingModels,
    fetchModels,
    resetSelection,
  } = useTranscriptionModels(transcriptModelConfig);

  const handleImportComplete = useCallback((result: ImportResult) => {
    toast.success('노트를 만들었습니다', { description: `${result.segments_count}개 문단` });

    // Refresh meetings list then navigate to the imported meeting
    refetchMeetings();
    onComplete?.();
    onOpenChange(false);
    router.push(`/meeting-details?id=${result.meeting_id}`);
  }, [router, refetchMeetings, onComplete, onOpenChange]);

  const handleImportError = useCallback((error: string) => {
    toast.error('업로드에 실패했습니다', { description: error });
  }, []);

  const {
    status,
    fileInfo,
    progress,
    error,
    isProcessing,
    isBusy,
    selectFile,
    validateFile,
    startImport,
    cancelImport,
    reset,
  } = useImportAudio({
    onComplete: handleImportComplete,
    onError: handleImportError,
  });

  // Reset state only when dialog transitions from closed to open
  // This prevents re-initialization when config changes while dialog is already open (Bug #4 & #5)
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    // Only initialize when transitioning from closed (false) to open (true)
    if (open && !wasOpen) {
      reset();
      resetSelection();
      setTitle('');
      setTitleModifiedByUser(false);
      setSelectedLang(initialImportLanguage());
      setShowAdvanced(false);

      // Validate preselected file if provided
      if (preselectedFile) {
        validateFile(preselectedFile).then((info) => {
          if (info) {
            setTitle(info.filename);
          }
        });
      }

      // Fetch available models using centralized hook
      fetchModels();
    }
  }, [open, preselectedFile, selectedLanguage, transcriptModelConfig, reset, resetSelection, validateFile, fetchModels]);

  // Update title when fileInfo changes
  useEffect(() => {
    if (fileInfo && !title && !titleModifiedByUser) {
      setTitle(fileInfo.filename);
    }
  }, [fileInfo, title, titleModifiedByUser]);

  const selectedModel = useMemo((): ModelOption | undefined => {
    if (!selectedModelKey) return undefined;
    const colonIndex = selectedModelKey.indexOf(':');
    if (colonIndex === -1) return undefined;
    const provider = selectedModelKey.slice(0, colonIndex);
    const name = selectedModelKey.slice(colonIndex + 1);
    return availableModels.find((m) => m.provider === provider && m.name === name);
  }, [selectedModelKey, availableModels]);
  const isParakeetModel = selectedModel?.provider === 'parakeet';

  useEffect(() => {
    if (isParakeetModel && selectedLang !== 'auto') {
      setSelectedLang('auto');
    }
  }, [isParakeetModel, selectedLang]);

  const handleSelectFile = async () => {
    const info = await selectFile();
    if (info) {
      setTitle(info.filename);
    }
  };

  const handleStartImport = async () => {
    if (!fileInfo) return;

    try {
      localStorage.setItem(IMPORT_LANGUAGE_KEY, selectedLang);
    } catch {
      // Remembering the language is optional
    }
    await startImport(
      fileInfo.path,
      title || fileInfo.filename,
      isParakeetModel ? null : selectedLang === 'auto' ? null : selectedLang,
      selectedModel?.name || null,
      selectedModel?.provider || null,
      { diarize, numSpeakers: diarize ? speakerCount : null }
    );
  };

  const handleCancel = async () => {
    if (isProcessing) {
      await cancelImport();
      toast.info('업로드를 취소했습니다');
    }
    onOpenChange(false);
  };

  // Prevent closing during processing
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isProcessing) {
      return;
    }
    onOpenChange(newOpen);
  };

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  const handleInteractOutside = (event: Event) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isProcessing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-note-green" />
                노트 만드는 중...
              </>
            ) : error ? (
              <>
                <AlertCircle className="h-5 w-5 text-red-600" />
                업로드 실패
              </>
            ) : status === 'complete' ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-note-green" />
                완료
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-note-green" />
                파일 업로드
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isProcessing
              ? stageLabel(progress?.stage)
              : error
              ? '파일을 처리하는 중 오류가 발생했습니다'
              : '회의 녹음 파일로 새 노트를 만듭니다'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* File selection / info */}
          {!isProcessing && !error && (
            <>
              {fileInfo ? (
                <div className="space-y-3 rounded-xl bg-note-canvas p-4">
                  <div className="flex items-start gap-3">
                    <FileAudio className="h-8 w-8 flex-shrink-0 text-note-green" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900">{fileInfo.filename}</p>
                      <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDuration(fileInfo.duration_seconds)}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3.5 w-3.5" />
                          {formatFileSize(fileInfo.size_bytes)}
                        </span>
                        <span className="font-medium uppercase text-note-green">{fileInfo.format}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSelectFile}
                      className="flex-shrink-0 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-white hover:text-gray-800"
                    >
                      다른 파일
                    </button>
                  </div>

                  {/* Editable title */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">노트 제목</label>
                    <Input
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        setTitleModifiedByUser(true);
                      }}
                      placeholder="노트 제목을 입력하세요"
                      className="bg-white"
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSelectFile}
                  disabled={status === 'validating'}
                  className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-note-green hover:bg-note-mint/40"
                >
                  {status === 'validating' ? (
                    <Loader2 className="mb-3 h-10 w-10 animate-spin text-note-green" />
                  ) : (
                    <FileAudio className="mb-3 h-10 w-10 text-gray-400" />
                  )}
                  <span className="text-sm font-semibold text-gray-900">
                    {status === 'validating' ? '파일 확인 중...' : '오디오 파일 선택'}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">MP3, M4A, WAV, MP4, FLAC, OGG, MKV, WebM, WMA</span>
                </button>
              )}

              {fileInfo && (
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {/* Language */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      <Globe className="h-4 w-4 text-gray-400" />
                      언어
                    </div>
                    {!isParakeetModel ? (
                      <Select value={selectedLang} onValueChange={setSelectedLang}>
                        <SelectTrigger className="h-8 w-48">
                          <SelectValue placeholder="언어 선택" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              {lang.code === 'ko' ? '한국어 (Korean)' : lang.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-gray-500">Parakeet은 자동 감지</span>
                    )}
                  </div>

                  {/* Speaker diarization */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-900">
                      <input
                        type="checkbox"
                        checked={diarize}
                        onChange={(e) => setDiarize(e.target.checked)}
                        className="h-4 w-4 accent-[#03C75A]"
                      />
                      <Users className="h-4 w-4 text-gray-400" />
                      화자 구분
                    </label>
                    <SpeakerCountSelect value={speakerCount} onChange={setSpeakerCount} disabled={!diarize} />
                  </div>

                  {/* Model (advanced) */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
                    >
                      <span>고급 설정</span>
                      {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {showAdvanced && availableModels.length > 0 && (
                      <div className="flex items-center justify-between gap-3 px-4 pb-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          <Cpu className="h-4 w-4 text-gray-400" />
                          전사 모델
                        </div>
                        <Select value={selectedModelKey} onValueChange={setSelectedModelKey} disabled={loadingModels}>
                          <SelectTrigger className="h-8 w-56">
                            <SelectValue placeholder={loadingModels ? '모델 불러오는 중...' : '모델 선택'} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.map((model) => (
                              <SelectItem key={`${model.provider}:${model.name}`} value={`${model.provider}:${model.name}`}>
                                {model.displayName} ({Math.round(model.size_mb)} MB)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Progress display */}
          {isProcessing && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-note-green transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(progress?.progress_percentage ?? 2, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{stageLabel(progress?.stage)}</span>
                <span>{Math.round(progress?.progress_percentage ?? 0)}%</span>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!isProcessing && !error && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button onClick={handleStartImport} className="bg-note-green hover:bg-note-green-dark" disabled={!fileInfo}>
                <Upload className="mr-2 h-4 w-4" />
                노트 만들기
              </Button>
            </>
          )}
          {isProcessing && (
            <Button variant="outline" onClick={handleCancel}>
              <X className="mr-2 h-4 w-4" />
              취소
            </Button>
          )}
          {error && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
              <Button onClick={reset} variant="outline">
                다시 시도
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
