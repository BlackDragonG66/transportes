import { useEffect, useState } from "react";
import { api } from "./api.js";
const serviceName = (car) => (car.service_type === "uber" ? "Uber" : "Taxi");
const description = (car) =>
  `${car.brand} ${car.model}${car.vehicle_year ? ` ${car.vehicle_year}` : ""}`;
export default function StaffVehicles({ user }) {
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(""),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load(id) {
    const d = await api("/staff/vehicles");
    setData(d);
    setSelected((old) => id || old || d.local[0]?.id || d.units[0]?.id || "");
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const local = data?.local.find((f) => f.id === selected),
    car = local || data?.units.find((f) => f.id === selected);
  useEffect(() => {
    setForm(
      local
        ? {
            brand: local.brand,
            model: local.model,
            vehicle_year: local.vehicle_year || "",
            color: local.color,
            service_type: local.service_type,
            plate: local.plate,
            capacity: local.capacity,
            luggage_capacity: local.luggage_capacity,
          }
        : null,
    );
  }, [selected, data]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api(`/staff/local-vehicles/${car.id}`, {
        method: "PATCH",
        body: {
          ...form,
          vehicle_year: Number(form.vehicle_year),
          capacity: Number(form.capacity),
          luggage_capacity: Number(form.luggage_capacity),
        },
      });
      await load(updated.id);
      setMessage(
        "Datos de tu unidad guardados. El QR conserva el mismo enlace y muestra los datos actualizados.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const field = (key, label, type = "text", attrs = {}) => (
    <label className="staff-vehicle-field" key={key}>
      {label}
      <input
        className="input"
        type={type}
        value={form?.[key] ?? ""}
        required
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...attrs}
      />
    </label>
  );
  return (
    <section className="staff-vehicle-workspace">
      <div className="staff-panel-heading">
        <div>
          <h2 className="title is-4">
            {user.role === "admin"
              ? "Unidades y QR del equipo"
              : "Mi unidad y QR"}
          </h2>
          <p>
            Revisa la unidad con la que trabajas y prepara el QR que llevarás
            visible para tus pasajeros.
          </p>
        </div>
        <button
          className="button is-light"
          disabled={busy}
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Actualizar unidades
        </button>
      </div>
      {!data && !error && <p role="status">Cargando tu unidad…</p>}
      {data && (
        <label className="label mb-5">
          Unidad registrada
          <div className="select is-fullwidth mt-2">
            <select
              aria-label="Unidad registrada"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {data.local.map((f) => (
                <option key={f.id} value={f.id}>
                  {description(f)} · {f.plate} · {f.city}
                  {user.role === "admin" ? ` · ${f.driver_name}` : ""}
                </option>
              ))}
              {data.units.map((f) => (
                <option key={f.id} value={f.id}>
                  {description(f)} · {f.plate} · Interurbana
                </option>
              ))}
            </select>
          </div>
        </label>
      )}
      {data && !car && (
        <p className="notification">
          Todavía no tienes una unidad asignada. La administración puede
          registrarla y vincularla a tu cuenta.
        </p>
      )}
      {car && (
        <div className="staff-vehicle-layout">
          <div className="box staff-vehicle-editor">
            <div className="staff-status">
              <span className="tag is-primary is-light">
                {local ? serviceName(car) : "Unidad interurbana"}
              </span>
              <span className="tag is-light">
                {car.active ? "Activa" : "Inactiva"}
              </span>
              {Boolean(car.demo) && (
                <span className="tag is-warning">DEMO</span>
              )}
            </div>
            <h3 className="title is-4">{description(car)}</h3>
            <strong className="plate">{car.plate}</strong>
            {local && (
              <div className="staff-vehicle-driver mt-5">
                <img
                  className="driver-photo"
                  src={car.photo_url}
                  alt={`Foto de ${car.driver_name}`}
                />
                <div>
                  <strong>{car.driver_name}</strong>
                  <p>
                    {car.city} · {serviceName(car)}
                  </p>
                  <p>
                    {car.rating_count
                      ? `${Number(car.rating_average).toFixed(1)} / 5 · ${car.rating_count} calificaciones`
                      : "Aún sin calificaciones"}
                  </p>
                </div>
              </div>
            )}
            {local && form ? (
              <>
                <p className="notification is-light mt-5">
                  Ciudad de servicio: <strong>{car.city}</strong>. La
                  administración gestiona la ciudad y el conductor asignado.
                </p>
                {Boolean(car.busy) && (
                  <p className="notification is-warning">
                    Tienes traslados aceptados. Finalízalos antes de cambiar los
                    datos de esta unidad.
                  </p>
                )}
                <form onSubmit={save}>
                  <fieldset disabled={busy || !car.editable}>
                    <div className="staff-vehicle-form">
                      {field("brand", "Marca", "text", {
                        minLength: 2,
                        maxLength: 80,
                      })}
                      {field("model", "Modelo", "text", {
                        minLength: 2,
                        maxLength: 120,
                      })}
                      {field("vehicle_year", "Año", "number", {
                        min: 1990,
                        max: new Date().getFullYear() + 1,
                        step: 1,
                      })}
                      {field("color", "Color", "text", {
                        minLength: 2,
                        maxLength: 40,
                      })}
                      {field("plate", "Placas", "text", {
                        minLength: 3,
                        maxLength: 80,
                      })}
                      <label className="staff-vehicle-field">
                        Servicio
                        <div className="select is-fullwidth">
                          <select
                            aria-label="Servicio"
                            value={form.service_type}
                            onChange={(e) =>
                              setForm({ ...form, service_type: e.target.value })
                            }
                          >
                            <option value="taxi">Taxi</option>
                            <option value="uber">Uber</option>
                          </select>
                        </div>
                      </label>
                      {field("capacity", "Lugares para pasajeros", "number", {
                        min: 1,
                        max: 4,
                        step: 1,
                      })}
                      {field(
                        "luggage_capacity",
                        "Capacidad de maletas",
                        "number",
                        { min: 0, max: 30, step: 1 },
                      )}
                    </div>
                    <button
                      className="button is-primary mt-5"
                      disabled={busy || !car.editable}
                    >
                      Guardar datos de mi unidad
                    </button>
                  </fieldset>
                </form>
              </>
            ) : (
              <p className="mt-5">
                Capacidad: <strong>{car.capacity} pasajeros</strong>. La
                administración gestiona los datos y asignación de esta unidad
                para mantener la programación de salidas.
              </p>
            )}
          </div>
          <div className="box staff-vehicle-qr-card">
            <p className="eyebrow">QR PARA LLEVAR EN LA UNIDAD</p>
            <h3 className="title is-4">Escanea y conoce tu unidad</h3>
            <img
              className="staff-vehicle-qr"
              src={car.qr}
              alt={`QR de la unidad ${car.plate}`}
            />
            <p className="staff-qr-url">{car.publicUrl}</p>
            <p className="mb-4">
              {local
                ? "Al escanearlo se muestran el conductor, su foto, placas, color, modelo y ciudad. Puedes actualizar los datos conservando el mismo QR."
                : "Al escanearlo se muestran el conductor y los datos del viaje durante el abordaje y trayecto."}
            </p>
            <div className="buttons">
              <a
                className="button is-light"
                href={car.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver como pasajero
              </a>
              <a
                className="button is-light"
                href={car.qr}
                download={`ConexionES-QR-${car.plate}.png`}
              >
                Descargar QR
              </a>
              <button
                className="button is-primary"
                onClick={() => window.print()}
              >
                Imprimir ficha con QR
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="notification is-danger is-light" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notification is-success is-light" role="status">
          {message}
        </p>
      )}
      {car && (
        <div className="staff-vehicle-poster">
          <h1>
            Conexion<span>ES</span>
          </h1>
          <p>ESCANEA ANTES DE ABORDAR</p>
          <h2>{description(car)}</h2>
          {local && (
            <p>
              {serviceName(car)} · {car.color} · {car.city}
            </p>
          )}
          <strong className="plate">{car.plate}</strong>
          {local && (
            <div className="staff-vehicle-driver">
              <img
                className="driver-photo"
                src={car.photo_url}
                alt={`Foto de ${car.driver_name}`}
              />
              <strong>{car.driver_name}</strong>
            </div>
          )}
          <img
            className="staff-vehicle-qr"
            src={car.qr}
            alt="QR para imprimir"
          />
          <p>Verifica las placas y al conductor de tu unidad</p>
          <p className="staff-qr-url">{car.publicUrl}</p>
          {Boolean(car.demo) && <p>UNIDAD DE DEMOSTRACIÓN</p>}
        </div>
      )}
    </section>
  );
}

export function TaxiVerification({ token }) {
  const [car, setCar] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/taxi/${token}`)
      .then((c) => {
        if (active) setCar(c);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (error)
    return (
      <p className="notification is-warning" role="alert">
        {error}
      </p>
    );
  if (!car) return <p role="status">Cargando datos de la unidad…</p>;
  return (
    <section className="boarding-wrap">
      <div className="box taxi-verification">
        <p className="eyebrow">CONEXIONES · IDENTIFICA TU UNIDAD</p>
        <h1 className="title is-3">Tu Taxi / Uber</h1>
        {car.demo && (
          <p className="notification is-warning is-light">
            UNIDAD DE DEMOSTRACIÓN
          </p>
        )}
        <div className="driver-card">
          <img
            className="driver-photo"
            src={car.photo_url}
            alt={`Foto de ${car.driver_name}`}
          />
          <div>
            <p>TU CONDUCTOR</p>
            <h2 className="title is-4 mb-2">{car.driver_name}</h2>
            <p>
              {car.rating_count
                ? `${Number(car.rating_average).toFixed(1)} / 5 · ${car.rating_count} calificaciones`
                : "Aún sin calificaciones"}
            </p>
          </div>
        </div>
        <hr />
        <h2 className="title is-4">{description(car)}</h2>
        <strong className="plate">{car.plate}</strong>
        <dl className="taxi-verification-details">
          <div>
            <dt>Color</dt>
            <dd>{car.color || "Pendiente de completar"}</dd>
          </div>
          <div>
            <dt>Servicio</dt>
            <dd>{serviceName(car)}</dd>
          </div>
          <div>
            <dt>Ciudad</dt>
            <dd>{car.city}</dd>
          </div>
          <div>
            <dt>Capacidad</dt>
            <dd>
              {car.capacity} pasajeros · {car.luggage_capacity} maletas
            </dd>
          </div>
        </dl>
        <p className="notification is-light mt-5">
          Compara las placas y la foto del conductor con el auto que llegó por
          ti. Consulta tu boleto para revisar tu traslado asignado.
        </p>
        <a className="button is-primary" href="/#bookings">
          Ver mis reservas
        </a>
      </div>
    </section>
  );
}
