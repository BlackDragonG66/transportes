import { useEffect, useState } from "react";
import { api, money } from "./api.js";
import ContentAdmin from "./ContentAdmin.jsx";
import { TeamAdmin } from "./Account.jsx";
const forms = {
  vehicles: {
    label: "Unidad interurbana",
    fields: { brand: "text", model: "text", plate: "text", capacity: "number" },
  },
  drivers: {
    label: "Conductor",
    fields: { user_id: "driverUsers", photo_url: "url", license: "text" },
  },
  local_fleet: {
    label: "Auto local",
    fields: {
      driver_id: "drivers",
      plate: "text",
      model: "text",
      city: "text",
      capacity: "number",
      luggage_capacity: "number",
    },
  },
  trips: {
    label: "Programar salida",
    fields: {
      route_id: "routes",
      vehicle_id: "vehicles",
      driver_id: "drivers",
      departure_at: "datetime-local",
      arrival_at: "datetime-local",
      capacity: "number",
    },
  },
  fares: {
    label: "Actualizar tarifa",
    fields: {
      route_id: "routes",
      passenger_type_id: "passenger_types",
      price_cents: "number",
    },
  },
  addons: {
    label: "Complemento",
    fields: { name: "text", price_cents: "number" },
  },
  passenger_types: { label: "Tipo de pasajero", fields: { name: "text" } },
  routes: {
    label: "Ruta",
    fields: { origin: "text", destination: "text", kind: "kind" },
  },
};
const fieldNames = {
  brand: "Marca",
  model: "Modelo",
  plate: "Placas",
  capacity: "Capacidad",
  user_id: "Usuario conductor",
  photo_url: "Foto HTTPS",
  license: "Licencia",
  driver_id: "Conductor",
  city: "Ciudad",
  luggage_capacity: "Capacidad de maletas",
  route_id: "Ruta",
  vehicle_id: "Unidad",
  departure_at: "Salida (hora de este dispositivo)",
  arrival_at: "Llegada (hora de este dispositivo)",
  passenger_type_id: "Tipo de pasajero",
  price_cents: "Precio en centavos MXN",
  name: "Nombre",
  origin: "Origen",
  destination: "Destino",
  kind: "Tipo de ruta",
};
export default function Admin({ onChanged }) {
  const [section, setSection] = useState("content");
  const [integrations, setIntegrations] = useState(null);
  const [resources, setResources] = useState(null),
    [table, setTable] = useState("vehicles"),
    [values, setValues] = useState({}),
    [message, setMessage] = useState(""),
    [qr, setQr] = useState(null),
    [refunds, setRefunds] = useState([]),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setResources(await api("/admin/resources"));
      setRefunds(await api("/admin/refunds"));
      setIntegrations(await api("/integrations"));
    } catch (e) {
      setMessage(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {};
      for (const [key, type] of Object.entries(forms[table].fields)) {
        body[key] =
          type === "number"
            ? Number(values[key])
            : type === "datetime-local"
              ? new Date(values[key]).toISOString()
              : values[key];
      }
      await api(`/admin/${table}`, { method: "POST", body });
      setValues({});
      setMessage("Guardado.");
      await load();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  const label = (r) =>
    r.name ||
    r.plate ||
    (r.origin ? `${r.origin} → ${r.destination}` : r.user_id || r.id);
  if (section !== "operations")
    return (
      <>
        <h1 className="title">Administración</h1>
        <div className="buttons admin-sections">
          {[
            ["content", "Página y publicidad"],
            ["operations", "Rutas, unidades y tarifas"],
            ["team", "Equipo y accesos"],
          ].map(([key, title]) => (
            <button
              key={key}
              className={`button ${section === key ? "is-primary" : "is-light"}`}
              onClick={() => setSection(key)}
            >
              {title}
            </button>
          ))}
        </div>
        {section === "content" ? (
          <ContentAdmin onChanged={onChanged} />
        ) : (
          <TeamAdmin />
        )}
      </>
    );
  return (
    <>
      <h1 className="title">Administración</h1>
      <div className="buttons">
        <button
          className="button is-light"
          onClick={() => setSection("content")}
        >
          Página y publicidad
        </button>
        <button className="button is-primary">Rutas, unidades y tarifas</button>
        <button className="button is-light" onClick={() => setSection("team")}>
          Equipo y accesos
        </button>
      </div>
      {integrations && (
        <div className="notification is-light">
          Mercado Pago:{" "}
          <strong>
            {integrations.payments ? "Activo" : "Pendiente de configuración"}
          </strong>{" "}
          · Correo:{" "}
          <strong>
            {integrations.email ? "Activo" : "Pendiente de configuración"}
          </strong>
        </div>
      )}
      <div className="box">
        <div className="select mb-4">
          <select
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setValues({});
            }}
          >
            {Object.entries(forms).map(([key, f]) => (
              <option key={key} value={key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={submit}>
          <div className="columns is-multiline">
            {Object.entries(forms[table].fields).map(([key, type]) => (
              <div className="column is-half" key={key}>
                <label className="label">{fieldNames[key]}</label>
                {[
                  "routes",
                  "vehicles",
                  "drivers",
                  "driverUsers",
                  "passenger_types",
                  "kind",
                ].includes(type) ? (
                  <div className="select is-fullwidth">
                    <select
                      required
                      value={values[key] || ""}
                      onChange={(e) =>
                        setValues({ ...values, [key]: e.target.value })
                      }
                    >
                      <option value="">Selecciona</option>
                      {type === "kind"
                        ? ["interurban", "airport", "medical"].map((v) => (
                            <option key={v}>{v}</option>
                          ))
                        : resources?.[type].map((r) => (
                            <option key={r.id} value={r.id}>
                              {label(r)}
                            </option>
                          ))}
                    </select>
                  </div>
                ) : (
                  <input
                    className="input"
                    required
                    type={type}
                    min={type === "number" ? 0 : undefined}
                    step={type === "number" ? 1 : undefined}
                    value={values[key] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [key]: e.target.value })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <button disabled={busy} className="button is-primary">
            Guardar
          </button>
        </form>
        {message && (
          <p className="notification mt-3" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="box">
        <h2 className="title is-4">QR físico de unidades</h2>
        <div className="buttons">
          {resources?.vehicles.map((v) => (
            <button
              className="button"
              key={v.id}
              onClick={async () => {
                try {
                  setQr({
                    ...(await api(`/admin/vehicle/${v.id}/qr`)),
                    plate: v.plate,
                  });
                } catch (e) {
                  setMessage(e.message);
                }
              }}
            >
              {v.plate}
            </button>
          ))}
        </div>
        {qr && (
          <div className="print-qr">
            <h3 className="title is-5">ConexionES · {qr.plate}</h3>
            <img
              className="ticket-qr"
              src={qr.qr}
              alt="QR para imprimir en unidad"
            />
            <p>{qr.url}</p>
            <button className="button" onClick={() => window.print()}>
              Imprimir QR
            </button>
          </div>
        )}
      </div>
      <div className="box">
        <h2 className="title is-4">Reembolsos pendientes</h2>
        {refunds.map((r) => (
          <div className="fare-row" key={r.id}>
            <span>
              {r.id}
              <small>{money(r.total_cents)}</small>
            </span>
            <button
              disabled={busy}
              className="button is-warning"
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/admin/refunds/${r.id}`, {
                    method: "POST",
                    body: {},
                  });
                  await load();
                } catch (e) {
                  setMessage(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reembolsar
            </button>
          </div>
        ))}
        {refunds.length === 0 && <p>No hay reembolsos pendientes.</p>}
      </div>
    </>
  );
}
