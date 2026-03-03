export default function StatusFeed({ items }) {
  return (
    <div className="h-64 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <div className="space-y-2 text-sm">
        {items.length === 0 ? <p className="text-slate-400">No activity yet.</p> : null}
        {items.map((item) => (
          <div key={item.id} className="rounded-md bg-slate-800/80 p-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">{item.type}</p>
            <p className="text-slate-100">{item.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
