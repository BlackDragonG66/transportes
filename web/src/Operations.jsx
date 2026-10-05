import { useEffect, useState } from "react";
import { api, date } from "./api.js";
import { parcelLabels } from "./Parcels.jsx";
const labels = {
  scheduled: "Programada",
  boarding: "Abordaje",
  en_route: "En ruta",
  arrived: "Llegó",
  waiting: "Por aceptar",
  accepted: "Aceptado",
  completed: "Completado",
};
const day = (v) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(v));
export default function Operations() {
  const [data, setData] = useState(null),
    [trips, setTrips] = useState([]),
    [fleet, setFleet] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [manifest, setManifest] = useState(null),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("");
  async function load() {
    try {
      const [d, t] = await Promise.all([
        api("/local/jobs"),
        api("/operations/trips"),
      ]);
      setData(d);
      setTrips(t);
      if (selected)
        setManifest(await api(`/operations/trips/${selected}/manifest`));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [selected]);
  async function act(path, body, method = "POST") {
    setBusy(true);
    try {
      await api(path, { method, body });
      await load();
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const dates = [...new Set(trips.map((t) => day(t.departure_at)))],
    chosen = filter || dates[0];
  return (
    <>
      <h1 className="title">Operación de viajes</h1>
      {error && (
        <p role="alert" className="notification is-danger is-light">
          {error}
        </p>
      )}
      <div className="box">
        <h2 className="title is-4">Mis salidas interurbanas</h2>
        {dates.length > 0 && (
          <label className="label">
            Día de operación
            <div className="select mt-2">
              <select
                aria-label="Día de operación"
                value={chosen || ""}
                onChange={(e) => setFilter(e.target.value)}
              >
                {dates.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
          </label>
        )}
        {trips
          .filter((t) => day(t.departure_at) === chosen)
          .map((t) => (
            <article className="operation-trip" key={t.id}>
              <div>
                <strong>
                  {t.origin} → {t.destination}
                </strong>
                <p>
                  {date(t.departure_at)} · {labels[t.status] || t.status}
                </p>
              </div>
              <div className="buttons">
                <button
                  className="button is-light is-small"
                  onClick={async () => {
                    try {
                      setManifest(
                        await api(`/operations/trips/${t.id}/manifest`),
                      );
                      setSelected(t.id);
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Pasajeros y carga
                </button>
                {["scheduled", "boarding", "en_route"].includes(t.status) && (
                  <button
                    disabled={busy}
                    className="button is-primary is-small"
                    onClick={() =>
                      act(
                        `/trips/${t.id}/status`,
                        {
                          status: {
                            scheduled: "boarding",
                            boarding: "en_route",
                            en_route: "arrived",
                          }[t.status],
                        },
                        "PATCH",
                      )
                    }
                  >
                    {
                      {
                        scheduled: "Iniciar abordaje",
                        boarding: "Salir a ruta",
                        en_route: "Registrar llegada",
                      }[t.status]
                    }
                  </button>
                )}
              </div>
            </article>
          ))}
        {trips.length === 0 && <p>No hay salidas asignadas.</p>}
      </div>
      {manifest && (
        <div className="box">
          <h2 className="title is-4">Lista de pasajeros y paquetería</h2>
          <p className="mb-4">
            {date(manifest.trip.departure_at)} · {labels[manifest.trip.status]}
          </p>
          {manifest.bookings.map((b) => (
            <div className="manifest-row" key={b.id}>
              <div>
                <strong>
                  {b.customer} · {b.passengers} lugares
                </strong>
                <ul>
                  {b.travelers.map((t, i) => (
                    <li key={i}>{t.full_name}</li>
                  ))}
                </ul>
                <span className="tag is-light">
                  {b.boarded_at ? "Abordaje validado" : "Por abordar"}
                </span>
              </div>
              <div className="buttons">
                <a
                  href={`/ticket/${b.ticket_token}`}
                  className="button is-light is-small"
                >
                  Ver boleto y QR
                </a>
                {!b.boarded_at && manifest.trip.status === "boarding" && (
                  <button
                    disabled={busy}
                    className="button is-primary is-small"
                    onClick={() => act(`/ticket/${b.ticket_token}/board`, {})}
                  >
                    Validar abordaje
                  </button>
                )}
              </div>
            </div>
          ))}
          {!manifest.bookings.length && <p>No hay pasajeros confirmados.</p>}
          <h3 className="title is-5 mt-5">Carga de esta unidad</h3>
          {manifest.parcels.map((p) => (
            <div className="manifest-row" key={p.id}>
              <div>
                <strong>
                  {p.description} · {p.grams / 1000} kg
                </strong>
                <p>
                  Recibe: {p.recipient_name} · {parcelLabels[p.status]}
                </p>
              </div>
              {p.status === "received" && (
                <button
                  disabled={busy || manifest.trip.status !== "boarding"}
                  className="button is-primary is-small"
                  onClick={() =>
                    act(`/parcels/${p.id}/action`, { action: "load" })
                  }
                >
                  Cargar paquete
                </button>
              )}
            </div>
          ))}
          {!manifest.parcels.length && <p>No hay paquetes recibidos.</p>}
        </div>
      )}
      <div className="box">
        <h2 className="title is-4">Viaje Rápido · Taxi / Uber</h2>
        <p className="mb-3">
          Puedes aceptar un solo traslado por llegada de unidad, incluso si ya
          lo completaste. Solo verás solicitudes de tu ciudad. Al aceptar verás
          los datos del cliente.
        </p>
        <div className="select mb-4 is-fullwidth">
          <select
            aria-label="Mi auto local"
            value={fleet}
            onChange={(e) => setFleet(e.target.value)}
          >
            <option value="">Elige tu auto</option>
            {data?.fleet
              .filter((f) => f.owned)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.model} · {f.plate} · {f.city}
                </option>
              ))}
          </select>
        </div>
        {data?.jobs.map((j) => (
          <div className="manifest-row" key={j.id}>
            <div>
              <strong>{j.zone}</strong>
              <p>
                {j.destination} · Llegada {date(j.arrival_at)}
              </p>
              <p>
                {j.passengers} pasajeros · {j.luggage} maletas ·{" "}
                {labels[j.status]}
              </p>
              {j.customer_name && (
                <p className="assigned-contact">
                  Cliente: <b>{j.customer_name}</b> ·{" "}
                  {j.customer_phone === "0000000000"
                    ? "Teléfono de demostración"
                    : j.customer_phone}
                </p>
              )}
              {j.driver_name && (
                <p>
                  Chofer: {j.driver_name} · {j.model} · {j.city}
                </p>
              )}
            </div>
            {j.status === "waiting" && (
              <button
                disabled={!fleet || busy}
                className="button is-primary"
                onClick={() =>
                  act(`/local/jobs/${j.id}/accept`, { fleetId: fleet })
                }
              >
                Aceptar
              </button>
            )}
            {j.status === "accepted" && j.owned && (
              <button
                disabled={busy}
                className="button"
                onClick={() => act(`/local/jobs/${j.id}/complete`, {})}
              >
                Completar traslado
              </button>
            )}
          </div>
        ))}
        {!data?.jobs.length && (
          <p>
            No hay solicitudes por ahora. El cliente puede pedir su auto desde
            un boleto confirmado.
          </p>
        )}
      </div>
    </>
  );
}
