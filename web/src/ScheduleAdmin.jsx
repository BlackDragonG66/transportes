import { useState } from "react";
import { api, date } from "./api.js";
export default function ScheduleAdmin({ resources, onChanged }) {
  const [v, setV] = useState({
      routeId: "",
      vehicleId: "",
      driverId: "",
      startDate: "",
      endDate: "",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      times: ["07:00"],
      durationMinutes: 180,
      capacity: 14,
      cargoPackages: 20,
      cargoKg: 100,
    }),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [key, setKey] = useState(crypto.randomUUID());
  const set = (k, value) => {
    setV({ ...v, [k]: value });
    setPreview(null);
    setKey(crypto.randomUUID());
    setMessage("");
  };
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!preview)
        setPreview(
          await api("/admin/schedules/preview", { method: "POST", body: v }),
        );
      else {
        const r = await api("/admin/schedules", {
          method: "POST",
          body: v,
          key,
        });
        setMessage(`${r.count} salidas programadas.`);
        setPreview(null);
        onChanged?.();
      }
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="box" onSubmit={submit}>
      <p className="eyebrow">PROGRAMACIÓN DE UNIDADES</p>
      <h2 className="title is-4">¿Qué salidas quieres generar?</h2>
      <p className="mb-4">
        Las horas corresponden a Ciudad de México. Se comprueba que la unidad y
        el conductor estén libres en todo el rango.
      </p>
      <div className="columns is-multiline">
        {[
          ["routeId", "Ruta", resources?.routes],
          ["vehicleId", "Unidad", resources?.vehicles],
          ["driverId", "Conductor", resources?.drivers],
        ].map(([k, label, rows]) => (
          <label key={k} className="column is-one-third">
            {label}
            <div className="select is-fullwidth">
              <select
                required
                value={v[k]}
                onChange={(e) => {
                  const value = e.target.value;
                  if (k === "vehicleId") {
                    const vehicle = resources.vehicles.find(
                      (x) => x.id === value,
                    );
                    setV({
                      ...v,
                      vehicleId: value,
                      capacity: vehicle.capacity,
                    });
                    setPreview(null);
                    setKey(crypto.randomUUID());
                  } else set(k, value);
                }}
              >
                <option value="">Selecciona</option>
                {rows
                  ?.filter((x) => x.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.origin
                        ? `${r.origin} → ${r.destination}`
                        : r.plate
                          ? `${r.brand} ${r.model} · ${r.plate}`
                          : resources.driverUsers.find(
                              (u) => u.id === r.user_id,
                            )?.name || r.license}
                    </option>
                  ))}
              </select>
            </div>
          </label>
        ))}
        {[
          ["startDate", "¿Desde cuándo?", "date"],
          ["endDate", "¿Hasta cuándo?", "date"],
          ["durationMinutes", "Duración (minutos)", "number"],
          ["capacity", "Lugares disponibles", "number"],
          ["cargoPackages", "Máximo de paquetes", "number"],
          ["cargoKg", "Carga máxima (kg)", "number"],
        ].map(([k, label, type]) => (
          <label className="column is-one-third" key={k}>
            {label}
            <input
              required
              className="input"
              type={type}
              min={type === "number" ? 0 : undefined}
              value={v[k]}
              onChange={(e) =>
                set(
                  k,
                  type === "number" ? Number(e.target.value) : e.target.value,
                )
              }
            />
          </label>
        ))}
      </div>
      <fieldset className="mb-4">
        <legend className="label">¿Qué días?</legend>
        <div className="weekday-options">
          {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d, i) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={v.weekdays.includes(i)}
                onChange={() =>
                  set(
                    "weekdays",
                    v.weekdays.includes(i)
                      ? v.weekdays.filter((n) => n !== i)
                      : [...v.weekdays, i],
                  )
                }
              />{" "}
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="label">Horarios de salida (máximo cuatro)</label>
      <div className="buttons">
        {v.times.map((t, i) => (
          <input
            key={i}
            aria-label={`Horario ${i + 1}`}
            className="input schedule-time"
            type="time"
            required
            value={t}
            onChange={(e) =>
              set(
                "times",
                v.times.map((s, j) => (i === j ? e.target.value : s)),
              )
            }
          />
        ))}
        {v.times.length < 4 && (
          <button
            type="button"
            className="button"
            onClick={() => set("times", [...v.times, "17:00"])}
          >
            Agregar horario
          </button>
        )}
        {v.times.length > 1 && (
          <button
            type="button"
            className="button"
            onClick={() => set("times", v.times.slice(0, -1))}
          >
            Quitar último
          </button>
        )}
      </div>
      {preview && (
        <div className="schedule-preview">
          <strong>
            {preview.trips.length} salidas · revisa antes de guardar
          </strong>
          <ul>
            {preview.trips.map((t) => (
              <li key={t.departure_at}>
                Salida {date(t.departure_at)} · llegada {date(t.arrival_at)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        disabled={busy}
        className={`button is-primary ${busy ? "is-loading" : ""}`}
      >
        {preview ? "Confirmar y programar salidas" : "Revisar las salidas"}
      </button>
      {message && (
        <p className="notification mt-4" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
