export default function SkillLog({ skills }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Skill Log</h3>
        <span className="text-xs text-slate-400">{skills.length}</span>
      </div>
      <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
        {skills.length === 0 ? <li className="text-slate-400">No saved skills yet.</li> : null}
        {skills.map((skill) => (
          <li key={`${skill.domain}-${skill.filename}`} className="rounded-md bg-slate-800 p-2">
            <p className="font-medium text-slate-100">{skill.name}</p>
            <p className="text-xs text-slate-400">{skill.domain}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
