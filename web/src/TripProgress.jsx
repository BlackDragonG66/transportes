import "./journey.css";
const stages = ["Todavía no inicia", "En viaje", "Viaje completado"];
export function tripStage(status, started) {
  return status === "arrived" || status === "completed"
    ? 2
    : status === "en_route" || started
      ? 1
      : 0;
}
export default function TripProgress({
  status,
  started,
  title = "Estado del viaje",
}) {
  const stage = tripStage(status, started),
    cancelled = status === "cancelled";
  return (
    <section className="trip-progress" aria-label={title}>
      <div className="trip-progress-heading">
        <h2>{title}</h2>
        <strong>{cancelled ? "Viaje cancelado" : stages[stage]}</strong>
      </div>
      <progress
        className="progress is-primary"
        value={cancelled ? 0 : stage * 50}
        max="100"
        aria-label={cancelled ? "Viaje cancelado" : stages[stage]}
      />
      <ol>
        {stages.map((label, i) => (
          <li
            key={label}
            className={i <= stage && !cancelled ? "reached" : ""}
            aria-current={i === stage && !cancelled ? "step" : undefined}
          >
            <span>{i < stage ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
    </section>
  );
}
