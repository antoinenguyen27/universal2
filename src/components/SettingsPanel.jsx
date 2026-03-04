import { useEffect, useState } from 'react';

export default function SettingsPanel({
  open,
  onClose,
  settings,
  skills,
  draft,
  touched,
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
  const [editingKeys, setEditingKeys] = useState({});

  useEffect(() => {
    if (!open || !hasChanges) setEditingKeys({});
  }, [open, hasChanges]);

  function renderKeyField({ field, label, configured, type = 'password', optional = false }) {
    const isEditing = Boolean(editingKeys[field]);
    const isTouched = Boolean(touched?.[field]);
    const value = String(draft?.[field] || '');
    const pendingUpdate = isTouched && Boolean(value.trim());
    const pendingClear = isTouched && !value.trim() && Boolean(configured);
    let statusText = configured ? 'Configured' : 'Not configured';
    if (pendingUpdate) statusText = 'Will update on save';
    if (pendingClear) statusText = 'Will clear on save';

    return (
      <div className="field-block">
        <span>{label}</span>
        <div className="key-row">
          <small className="muted-text key-status">{statusText}</small>
          <div className="key-row-actions">
            <button
              type="button"
              className="glass-btn muted small key-btn"
              onClick={() => setEditingKeys((prev) => ({ ...prev, [field]: true }))}
            >
              Update
            </button>
            <button
              type="button"
              className="glass-btn danger small key-btn"
              disabled={!configured && !pendingUpdate}
              onClick={() => {
                onDraftChange(field, '');
                setEditingKeys((prev) => ({ ...prev, [field]: false }));
              }}
            >
              Clear
            </button>
          </div>
        </div>
        {isEditing ? (
          <input
            className="glass-input"
            type={type}
            autoComplete="off"
            value={value}
            onChange={(event) => onDraftChange(field, event.target.value)}
            placeholder={optional ? 'Enter value' : 'Enter new key'}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass-modal modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-scroll">
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
            {renderKeyField({
              field: 'openrouterKey',
              label: 'OpenRouter API Key',
              configured: settings.openrouterConfigured
            })}
            {renderKeyField({
              field: 'anthropicKey',
              label: 'Anthropic API Key',
              configured: settings.anthropicConfigured
            })}
            {renderKeyField({
              field: 'elevenlabsKey',
              label: 'ElevenLabs API Key (optional)',
              configured: settings.elevenlabsConfigured,
              optional: true
            })}
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
            <p>Execution: {settings.executionModel || 'anthropic/claude-haiku-4-5-20251001'}</p>
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
    </div>
  );
}
