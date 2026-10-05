import { useEffect, useRef, useState } from "react";
import { api, date } from "./api.js";
import { parcelLabels } from "./Parcels.jsx";
import StaffConfirm from "./StaffConfirm.jsx";
const labels = {
  scheduled: "Programada",
  boarding: "En abordaje",
  en_route: "En camino",
  arrived: "Finalizada",
  waiting: "Disponible",
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
export default function UnitOperations({ user }) {
  const [trips, setTrips] = useState([]),
    [loaded, setLoaded] = useState(false),
    [selected, setSelected] = useState(""),
    [manifest, setManifest] = useState(null),
    [filter, setFilter] = useState(""),
    [historyView, setHistoryView] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(null);
  const generation = useRef(0);
  async function load() {
    const request = ++generation.current;
    try {
      const rows = await api("/operations/trips");
      const m = selected
        ? await api(`/operations/trips/${selected}/manifest`)
        : null;
      if (request !== generation.current) return;
      setTrips(rows);
      setManifest(m);
      setLoaded(true);
      setError("");
    } catch (e) {
      if (request === generation.current) {
        setError(e.message);
        setLoaded(true);
      }
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [selected]);
  async function act(path, body, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body });
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const visible = trips.filter((t) =>
      historyView ? t.status === "arrived" : t.status !== "arrived",
    ),
    dates = [...new Set(visible.map((t) => day(t.departure_at)))],
    chosen = dates.includes(filter) ? filter : dates[0],
    trip = trips.find((t) => t.id === selected),
    boarding =
      manifest?.bookings
        .filter((b) => b.boarded_at)
        .reduce((sum, b) => sum + b.passengers, 0) || 0,
    reserved =
      manifest?.bookings.reduce((sum, b) => sum + b.passengers, 0) || 0;
  const next =
    trip?.status === "scheduled"
      ? trip.accepted_at
        ? {
            label: "Iniciar abordaje",
            status: "boarding",
            description:
              "Abre la validación de boletos y prepara la carga de esta salida.",
          }
        : {
            label: "Aceptar salida asignada",
            description:
              "Confirma que recibirás esta salida con la unidad indicada.",
          }
      : trip?.status === "boarding"
        ? {
            label: "Iniciar viaje",
            status: "en_route",
            description: `Revisa los pasajeros y carga antes de salir. ${boarding} de ${reserved} viajeros tienen abordaje registrado.`,
          }
        : trip?.status === "en_route"
          ? {
              label: "Registrar llegada",
              status: "arrived",
              description:
                "Confirma que la unidad llegó al destino. La paquetería quedará disponible para recoger en taquilla.",
            }
          : null;
  const step =
    trip?.status === "arrived"
      ? 4
      : trip?.status === "en_route"
        ? 3
        : trip?.status === "boarding"
          ? 2
          : trip?.accepted_at
            ? 1
            : 0;
  return (
    <section>
      <div className="staff-panel-heading">
        <div>
          <h2 className="title is-4">
            {user.role === "admin"
              ? "Supervisión de salidas"
              : "Mis salidas asignadas"}
          </h2>
          <p className="muted">
            La administración asigna ruta, unidad y horario. Acepta tu salida
            para comenzar la operación.
          </p>
        </div>
        <button className="button is-light" disabled={busy} onClick={load}>
          Actualizar salidas
        </button>
      </div>
      <div className="staff-metrics">
        <div>
          <strong>
            {
              trips.filter((t) => t.status === "scheduled" && !t.accepted_at)
                .length
            }
          </strong>
          <span>Por aceptar</span>
        </div>
        <div>
          <strong>
            {
              trips.filter((t) => ["boarding", "en_route"].includes(t.status))
                .length
            }
          </strong>
          <span>En operación</span>
        </div>
        <div>
          <strong>{trips.filter((t) => t.status === "arrived").length}</strong>
          <span>Finalizadas</span>
        </div>
      </div>
      <div className="staff-filters">
        <div className="buttons">
          <button
            className={`button ${!historyView ? "is-primary" : "is-light"}`}
            onClick={() => {
              setHistoryView(false);
              setSelected("");
            }}
          >
            Próximas y en curso
          </button>
          <button
            className={`button ${historyView ? "is-primary" : "is-light"}`}
            onClick={() => {
              setHistoryView(true);
              setSelected("");
            }}
          >
            Historial de viajes
          </button>
        </div>
        {dates.length > 0 && (
          <label>
            Día de operación
            <div className="select">
              <select
                aria-label="Día de operación"
                value={chosen || ""}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSelected("");
                }}
              >
                {dates.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
          </label>
        )}
      </div>
      {error && (
        <p className="notification is-danger is-light" role="alert">
          {error}
        </p>
      )}
      {!loaded && !error && <p role="status">Cargando salidas…</p>}
      {loaded && !visible.length && (
        <div className="box">
          <p>
            {historyView
              ? "Aún no tienes viajes finalizados."
              : "No tienes salidas asignadas. La administración debe programar tu unidad y conductor."}
          </p>
        </div>
      )}
      {visible.length > 0 && (
        <div className="staff-unit-layout">
          <div className="staff-trip-list" aria-label="Lista de salidas">
            {visible
              .filter((t) => day(t.departure_at) === chosen)
              .map((t) => (
                <article
                  className={`operation-trip ${selected === t.id ? "is-selected" : ""}`}
                  key={t.id}
                >
                  <div>
                    <div className="staff-status">
                      <span className="tag is-light">{labels[t.status]}</span>
                      {t.accepted_at && (
                        <span className="tag is-success is-light">
                          Salida aceptada
                        </span>
                      )}
                    </div>
                    <strong>
                      {t.origin} → {t.destination}
                    </strong>
                    <p>Salida: {date(t.departure_at)}</p>
                    <p>
                      {t.brand} {t.model} · {t.plate}
                    </p>
                    {user.role === "admin" && <p>Conductor: {t.driver_name}</p>}
                  </div>
                  <button
                    className="button is-light"
                    aria-pressed={selected === t.id}
                    onClick={() => {
                      if (selected === t.id) load();
                      else {
                        setManifest(null);
                        setSelected(t.id);
                      }
                    }}
                  >
                    Ver salida y operar
                  </button>
                </article>
              ))}
          </div>
          <div>
            {!trip ? (
              <div className="box">
                <h2 className="title is-5">Elige una salida</h2>
                <p>
                  Abre una salida para aceptar la asignación, ver pasajeros y
                  carga, y avanzar cada etapa.
                </p>
              </div>
            ) : (
              <div className="box">
                <h2 className="title is-4">
                  {trip.origin} → {trip.destination}
                </h2>
                <p>
                  {date(trip.departure_at)} · {trip.brand} {trip.model} ·{" "}
                  {trip.plate}
                </p>
                <ol className="staff-progress" aria-label="Etapas del viaje">
                  {[
                    "Aceptar salida",
                    "Iniciar abordaje",
                    "Pasajeros y carga",
                    "Iniciar viaje",
                    "Llegada",
                  ].map((name, i) => (
                    <li
                      className={step === i ? "current" : ""}
                      aria-current={step === i ? "step" : undefined}
                      key={name}
                    >
                      {i + 1}. {name}
                    </li>
                  ))}
                </ol>
                {next ? (
                  <div className="staff-primary-action">
                    <p>{next.description}</p>
                    <button
                      className="button is-primary"
                      disabled={busy || !manifest}
                      onClick={() =>
                        setConfirm({
                          title: next.label,
                          path: next.status
                            ? `/trips/${trip.id}/status`
                            : `/operations/trips/${trip.id}/accept`,
                          method: next.status ? "PATCH" : "POST",
                          body: next.status ? { status: next.status } : {},
                          description: next.description,
                        })
                      }
                    >
                      {next.label}
                    </button>
                  </div>
                ) : (
                  <p className="notification is-success is-light">
                    Viaje finalizado. Puedes consultar su lista y carga en el
                    historial.
                  </p>
                )}
                {!manifest ? (
                  <p role="status">Cargando pasajeros y carga…</p>
                ) : (
                  <>
                    <h3 className="title is-5">
                      Pasajeros · {boarding} / {reserved} abordados
                    </h3>
                    {manifest.bookings.map((b) => (
                      <div className="manifest-row" key={b.id}>
                        <div>
                          <strong>
                            {b.customer} · {b.passengers} lugares
                          </strong>
                          <ul>
                            {b.travelers.map((p, i) => (
                              <li key={i}>{p.full_name}</li>
                            ))}
                          </ul>
                          <span className="tag is-light">
                            {b.boarded_at
                              ? "Abordaje registrado"
                              : "Pendiente de validar"}
                          </span>
                        </div>
                        <div className="buttons">
                          <a
                            className="button is-small is-light"
                            href={`/ticket/${b.ticket_token}`}
                          >
                            Ver boleto / QR
                          </a>
                          <button
                            className="button is-primary is-small"
                            disabled={
                              busy ||
                              trip.status !== "boarding" ||
                              Boolean(b.boarded_at)
                            }
                            onClick={() =>
                              act(`/ticket/${b.ticket_token}/board`, {})
                            }
                          >
                            {b.boarded_at ? "Validado" : "Validar abordaje"}
                          </button>
                        </div>
                      </div>
                    ))}
                    {!manifest.bookings.length && (
                      <p className="muted">
                        No hay boletos confirmados para esta salida.
                      </p>
                    )}
                    <h3 className="title is-5 mt-5">Paquetería a bordo</h3>
                    {manifest.parcels.map((p) => (
                      <div className="manifest-row" key={p.id}>
                        <div>
                          <strong>{p.description}</strong>
                          <p>
                            {p.grams / 1000} kg · {parcelLabels[p.status]} ·{" "}
                            {p.recipient_name}
                          </p>
                        </div>
                        {p.status === "received" && (
                          <button
                            className="button is-primary is-small"
                            disabled={busy || trip.status !== "boarding"}
                            onClick={() =>
                              act(`/parcels/${p.id}/action`, { action: "load" })
                            }
                          >
                            Cargar paquete
                          </button>
                        )}
                      </div>
                    ))}
                    {!manifest.parcels.length && (
                      <p className="muted">No hay paquetes recibidos.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {confirm && (
        <StaffConfirm
          title={confirm.title}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => act(confirm.path, confirm.body, confirm.method)}
        >
          <p>
            <strong>
              {trip?.origin} → {trip?.destination}
            </strong>
          </p>
          <p>
            {trip?.brand} {trip?.model} · {trip?.plate}
          </p>
          <p className="mt-3">{confirm.description}</p>
          {error && <p className="help is-danger">{error}</p>}
        </StaffConfirm>
      )}
    </section>
  );
}
export function LocalOperations({ user }) {
  const [data, setData] = useState(null),
    [fleet, setFleet] = useState(""),
    [view, setView] = useState("waiting"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(null);
  async function load() {
    try {
      const d = await api("/local/jobs");
      setData(d);
      setFleet((old) =>
        d.fleet.some((f) => f.owned && f.id === old)
          ? old
          : d.fleet.find((f) => f.owned)?.id || "",
      );
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);
  async function act(j, action) {
    setBusy(true);
    try {
      await api(`/local/jobs/${j.id}/${action}`, {
        method: "POST",
        body: action === "accept" ? { fleetId: fleet } : {},
      });
      setConfirm(null);
      if (action === "accept") setView("accepted");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const car = data?.fleet.find((f) => f.id === fleet),
    ownFleet = data?.fleet.filter((f) => f.owned) || [],
    jobs = data?.jobs || [],
    eligible = jobs.filter(
      (j) =>
        j.status !== "waiting" ||
        user.role === "admin" ||
        !car ||
        (j.service_city === car.city &&
          j.passengers <= car.capacity &&
          j.luggage <= car.luggage_capacity),
    ),
    active = jobs.some((j) => j.status === "accepted" && j.fleet_id === fleet);
  return (
    <section>
      <div className="staff-panel-heading">
        <div>
          <h2 className="title is-4">
            {user.role === "admin"
              ? "Supervisión de taxis y Uber"
              : "Mis traslados · Taxi / Uber"}
          </h2>
          <p className="muted">
            {user.role === "admin"
              ? "Consulta solicitudes y asignaciones en ambas ciudades. Cada chofer opera con su propio acceso."
              : "Recibe solicitudes de tu ciudad. Puedes aceptar un traslado por llegada de unidad, incluso si ya lo completaste."}
          </p>
        </div>
        <button className="button is-light" onClick={load} disabled={busy}>
          Actualizar solicitudes
        </button>
      </div>
      {ownFleet.length > 0 && (
        <div className="box">
          <label className="label">
            Auto de trabajo
            <div className="select is-fullwidth mt-2">
              <select
                aria-label="Auto de trabajo"
                value={fleet}
                onChange={(e) => setFleet(e.target.value)}
              >
                {ownFleet.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.model} · {f.plate} · {f.city}
                  </option>
                ))}
              </select>
            </div>
          </label>
          {car && (
            <p className="muted">
              Cobertura: {car.city} · Hasta {car.capacity} pasajeros y{" "}
              {car.luggage_capacity} maletas.
            </p>
          )}
          {active && (
            <p className="notification is-info is-light mt-3">
              Tienes un traslado aceptado con este auto. Complétalo antes de
              tomar otro.
            </p>
          )}
        </div>
      )}
      <div className="staff-metrics">
        {[
          ["waiting", "Disponibles"],
          ["accepted", user.role === "admin" ? "Asignados" : "Mis aceptados"],
          ["completed", "Finalizados"],
        ].map(([status, title]) => (
          <div key={status}>
            <strong>
              {eligible.filter((j) => j.status === status).length}
            </strong>
            <span>{title}</span>
          </div>
        ))}
      </div>
      <div className="buttons mb-5">
        {[
          ["waiting", "Solicitudes disponibles"],
          [
            "accepted",
            user.role === "admin"
              ? "Traslados asignados"
              : "Mis traslados aceptados",
          ],
          ["completed", "Historial de traslados"],
        ].map(([status, title]) => (
          <button
            key={status}
            className={`button ${view === status ? "is-primary" : "is-light"}`}
            onClick={() => setView(status)}
          >
            {title}
          </button>
        ))}
      </div>
      {error && (
        <p className="notification is-danger is-light" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Cargando solicitudes…</p>}
      <div className="staff-job-grid">
        {eligible
          .filter((j) => j.status === view)
          .map((j) => (
            <article className="box" key={j.id}>
              <div className="staff-status">
                <span className="tag is-light">{j.service_city}</span>
                <span className="tag is-primary is-light">
                  {labels[j.status]}
                </span>
              </div>
              <h3>{j.zone}</h3>
              <p>Llegada de unidad: {date(j.arrival_at)}</p>
              <p>
                {j.passengers} pasajeros · {j.luggage} maletas
              </p>
              {j.driver_name && (
                <p>
                  Chofer: {j.driver_name} · {j.model}
                </p>
              )}
              {j.customer_name && (
                <p className="assigned-contact">
                  Cliente: <strong>{j.customer_name}</strong> ·{" "}
                  {j.customer_phone === "0000000000" ? (
                    "Teléfono de demostración"
                  ) : (
                    <a href={`tel:${j.customer_phone}`}>{j.customer_phone}</a>
                  )}
                </p>
              )}
              {j.status === "waiting" && ownFleet.length > 0 && (
                <button
                  className="button is-primary"
                  disabled={busy || !car || active}
                  onClick={() => setConfirm({ job: j, action: "accept" })}
                >
                  Aceptar traslado
                </button>
              )}
              {j.status === "accepted" && j.owned && (
                <button
                  className="button is-primary"
                  disabled={busy}
                  onClick={() => setConfirm({ job: j, action: "complete" })}
                >
                  Completar traslado
                </button>
              )}
            </article>
          ))}
      </div>
      {data && !eligible.some((j) => j.status === view) && (
        <div className="box">
          <p>
            {view === "waiting"
              ? "No hay nuevas solicitudes disponibles para tu ciudad y llegadas elegibles. Aparecerán cuando un cliente solicite su auto después de confirmar el boleto."
              : view === "accepted"
                ? "Todavía no tienes traslados aceptados."
                : "Todavía no hay traslados finalizados."}
          </p>
        </div>
      )}
      {confirm && (
        <StaffConfirm
          title={
            confirm.action === "accept"
              ? "Aceptar traslado"
              : "Completar traslado"
          }
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => act(confirm.job, confirm.action)}
        >
          <p>
            <strong>{confirm.job.zone}</strong> · {confirm.job.service_city}
          </p>
          <p>
            {confirm.job.passengers} pasajeros · {confirm.job.luggage} maletas
          </p>
          <p>Llegada: {date(confirm.job.arrival_at)}</p>
          <p className="mt-3">
            {confirm.action === "accept"
              ? `Atenderás esta solicitud con ${car?.model}, placas ${car?.plate}. Esta llegada quedará asignada a ti para un único traslado.`
              : "Confirma que entregaste a los pasajeros en su destino. No podrás tomar otra solicitud de esta misma llegada."}
          </p>
          {error && <p className="help is-danger">{error}</p>}
        </StaffConfirm>
      )}
    </section>
  );
}
