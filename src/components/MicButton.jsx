export default function MicButton({ isRecording, disabled, onPressStart, onPressEnd }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={isRecording ? onPressEnd : undefined}
      onTouchStart={(event) => {
        event.preventDefault();
        onPressStart();
      }}
      onTouchEnd={(event) => {
        event.preventDefault();
        onPressEnd();
      }}
      className={`w-full rounded-xl px-4 py-5 text-lg font-semibold transition ${
        disabled
          ? 'cursor-not-allowed bg-slate-700 text-slate-300'
          : isRecording
            ? 'bg-danger text-white shadow-[0_0_25px_rgba(239,68,68,0.6)]'
            : 'bg-mint text-slate-950 hover:bg-emerald-400'
      }`}
    >
      {isRecording ? 'Release to Send' : 'Hold to Talk'}
    </button>
  );
}
