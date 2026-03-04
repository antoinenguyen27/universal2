import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const executionMode = draft.executionMode || 'hybrid';
  const [editingKeys, setEditingKeys] = useState({});
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const modeInfoBtnRef = useRef(null);
  const modeTooltipRef = useRef(null);
  const closeTooltipTimerRef = useRef(null);

  useEffect(() => {
    if (!open || !hasChanges) setEditingKeys({});
  }, [open, hasChanges]);

  useEffect(
    () => () => {
      if (closeTooltipTimerRef.current) clearTimeout(closeTooltipTimerRef.current);
    },
    []
  );

  function updateTooltipPosition() {
    const button = modeInfoBtnRef.current;
    const tooltip = modeTooltipRef.current;
    if (!button || !tooltip) return;

    const margin = 12;
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = buttonRect.right - tooltipRect.width;
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

    let top = buttonRect.bottom + 8;
    if (top + tooltipRect.height > window.innerHeight - margin) {
      top = buttonRect.top - tooltipRect.height - 8;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    setTooltipPos({ top: Math.round(top), left: Math.round(left) });
  }

  useEffect(() => {
    if (!tooltipOpen) return undefined;
    updateTooltipPosition();
    const onResize = () => updateTooltipPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [tooltipOpen]);

  function openTooltip() {
    if (closeTooltipTimerRef.current) clearTimeout(closeTooltipTimerRef.current);
    setTooltipOpen(true);
  }

  function closeTooltipSoon() {
    if (closeTooltipTimerRef.current) clearTimeout(closeTooltipTimerRef.current);
    closeTooltipTimerRef.current = setTimeout(() => setTooltipOpen(false), 120);
  }

  function renderModeTooltip() {
    if (!tooltipOpen) return null;
    return createPortal(
      <div
        ref={modeTooltipRef}
        className="mode-tooltip-floating"
        role="tooltip"
        style={{ top: `${tooltipPos.top}px`, left: `${tooltipPos.left}px` }}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltipSoon}
      >
        <div className="mode-tooltip-scroll">
          <table className="mode-tooltip-table">
            <thead>
              <tr>
                <th />
                <th>DOM</th>
                <th>CUA</th>
                <th>Hybrid</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Cost</th>
                <td>🟢 Lowest (text-based DOM/a11y tree)</td>
                <td>🟡 Medium (screenshots each step)</td>
                <td>🔴 Highest (screenshots + DOM tools)</td>
              </tr>
              <tr>
                <th>Speed</th>
                <td>🟢 Fastest (no image processing)</td>
                <td>🟡 Medium (image reasoning per step)</td>
                <td>🔴 Slowest (both tool types available)</td>
              </tr>
              <tr>
                <th>Accuracy</th>
                <td>🟡 Good for structured pages, weaker on visual/dynamic UIs</td>
                <td>🟡 Good for visual tasks, but can misclick coordinates</td>
                <td>🟢 Most robust ("accounts for where each may fall short")</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>,
      document.body
    );
  }

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
        <div className="settings-scroll-shell">
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

          <div className="execution-mode-row">
            <div className="execution-mode-head">
              <span>Execution Mode</span>
              <div className="mode-info-wrap">
                <button
                  ref={modeInfoBtnRef}
                  type="button"
                  className="mode-info-btn"
                  aria-label="Execution mode comparison"
                  onMouseEnter={openTooltip}
                  onMouseLeave={closeTooltipSoon}
                  onFocus={openTooltip}
                  onBlur={closeTooltipSoon}
                >
                  i
                </button>
              </div>
            </div>
            <div className="glass-pill execution-mode-pill" role="radiogroup" aria-label="Execution mode">
              {['dom', 'cua', 'hybrid'].map((modeValue) => (
                <button
                  key={modeValue}
                  type="button"
                  role="radio"
                  aria-checked={executionMode === modeValue}
                  className={executionMode === modeValue ? 'active' : ''}
                  onClick={() => onDraftChange('executionMode', modeValue)}
                >
                  {modeValue.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

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
            <p>Mode: {(settings.executionMode || 'hybrid').toUpperCase()}</p>
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
      {renderModeTooltip()}
    </div>
  );
}
