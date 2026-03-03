function Indicator({ label, active }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-slate-800 px-2 py-1">
      <span className="text-xs text-slate-300">{label}</span>
      <span className={`text-xs font-semibold ${active ? 'text-mint' : 'text-amber'}`}>
        {active ? 'set' : 'missing'}
      </span>
    </div>
  );
}

export default function SettingsPanel({ settings, onChangeModel }) {
  const cuaChoices = [
    'anthropic/claude-sonnet-4-20250514',
    'google/gemini-2.5-computer-use-preview-10-2025',
    'google/gemini-3-flash-preview'
  ];

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-200">Settings</h3>
      <div className="grid grid-cols-2 gap-2">
        <Indicator label="OpenRouter" active={Boolean(settings.openrouterKey)} />
        <Indicator label="ElevenLabs" active={Boolean(settings.elevenlabsKey)} />
        <Indicator label="Voice ID" active={Boolean(settings.elevenlabsVoiceId)} />
      </div>
      <div className="mt-2 text-xs text-slate-400">
        <label className="mb-1 block">CUA model</label>
        <select
          value={settings.cuaModel || 'anthropic/claude-sonnet-4-20250514'}
          onChange={(event) => onChangeModel?.({ cuaModel: event.target.value })}
          className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
        >
          {cuaChoices.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <p className="mt-2">Orchestrator: {settings.orchestratorModel || 'inception/mercury'}</p>
      </div>
    </div>
  );
}
