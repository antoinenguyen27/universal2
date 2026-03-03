export default function SettingsPanel({
  open,
  onClose,
  settings,
  skills,
  draft,
  onDraftChange,
  onSave,
  saving,
  saveError,
  hasChanges,
  onDeleteSkill,
  deletingSkillId
}) {
  if (!open) return null;

  const missing = settings?.missingRequiredKeys || [];
  const requiredReady = missing.length === 0;
  const skillList = skills || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass-modal modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <h3>Settings</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <p className={`status-pill ${requiredReady ? 'status-ok' : 'status-warning'}`}>
          {requiredReady
            ? 'Runtime ready'
            : `Missing required keys: ${missing.join(', ')}`}
        </p>

        <div className="field-grid">
          <label className="field-block">
            <span>OpenRouter API Key</span>
            <input
              className="glass-input"
              type="password"
              autoComplete="off"
              value={draft.openrouterKey}
              onChange={(event) => onDraftChange('openrouterKey', event.target.value)}
              placeholder={settings.openrouterConfigured ? 'Configured' : 'Enter key'}
            />
          </label>
          <label className="field-block">
            <span>Google GenAI API Key</span>
            <input
              className="glass-input"
              type="password"
              autoComplete="off"
              value={draft.googleKey}
              onChange={(event) => onDraftChange('googleKey', event.target.value)}
              placeholder={settings.googleConfigured ? 'Configured' : 'Enter key'}
            />
          </label>
          <label className="field-block">
            <span>ElevenLabs API Key (optional)</span>
            <input
              className="glass-input"
              type="password"
              autoComplete="off"
              value={draft.elevenlabsKey}
              onChange={(event) => onDraftChange('elevenlabsKey', event.target.value)}
              placeholder={settings.elevenlabsConfigured ? 'Configured' : 'Optional'}
            />
          </label>
          <label className="field-block">
            <span>ElevenLabs Voice ID (optional)</span>
            <input
              className="glass-input"
              type="text"
              autoComplete="off"
              value={draft.elevenlabsVoiceId}
              onChange={(event) => onDraftChange('elevenlabsVoiceId', event.target.value)}
              placeholder={settings.elevenlabsVoiceConfigured ? 'Configured' : 'Optional'}
            />
          </label>
        </div>

        <label className="toggle-row">
          <span>Debug Mode</span>
          <button
            type="button"
            className={`glass-toggle ${draft.debugMode ? 'enabled' : ''}`}
            onClick={() => onDraftChange('debugMode', !draft.debugMode)}
            aria-pressed={draft.debugMode}
          >
            <span className="glass-toggle-thumb" />
          </button>
        </label>

        <div className="settings-meta">
          <p>Execution: {settings.executionModel || 'google/gemini-3-flash-preview'}</p>
          <p>Orchestrator: {settings.orchestratorModel || 'google/gemini-3-flash-preview'}</p>
          <p>Demo: {settings.demoModel || 'google/gemini-2.5-flash'}</p>
        </div>

        {hasChanges ? (
          <div className="actions-row">
            <button type="button" className="glass-btn muted small settings-action-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="glass-btn primary small settings-action-btn"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        ) : null}
        {saveError && hasChanges ? <p className="error-line">{saveError}</p> : null}

        <div className="skills-panel glass-inset">
          <div className="panel-head">
            <h4>Skills</h4>
            <span>{skillList.length}</span>
          </div>
          <ul className="skills-list">
            {skillList.length === 0 ? <li className="muted-text">No saved skills yet.</li> : null}
            {skillList.map((skill) => {
              const id = `${skill.domain}/${skill.filename}`;
              return (
                <li key={id} className="skill-row">
                  <div>
                    <p>{skill.name}</p>
                    <small>{skill.domain}</small>
                  </div>
                  <button
                    type="button"
                    className="glass-btn danger small"
                    disabled={deletingSkillId === id}
                    onClick={() => onDeleteSkill(skill)}
                  >
                    {deletingSkillId === id ? 'Deleting...' : 'Delete'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
