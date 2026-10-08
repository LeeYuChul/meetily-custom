'use client';

/** "자동" or a fixed number of participants, shared by upload and speaker-detection dialogs */
export function SpeakerCountSelect({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value ?? 'auto'}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === 'auto' ? null : Number(e.target.value))}
      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-note-green focus:outline-none focus:ring-2 focus:ring-note-green/30 disabled:opacity-50"
      aria-label="참석자 수"
    >
      <option value="auto">자동 감지</option>
      {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
        <option key={n} value={n}>
          {n}명
        </option>
      ))}
    </select>
  );
}
