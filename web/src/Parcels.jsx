import { useEffect, useRef, useState } from "react";
import { api, money, date } from "./api.js";
export const parcelLabels = {
  reserved: "Por recibir en taquilla",
  received: "Recibido y pagado",
  loaded: "Cargado en unidad",
  in_transit: "En camino",
  arrived: "Listo para recoger",
  delivered: "Entregado",
  cancelled: "Cancelado",
};
export function ParcelTracking({ token }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    const load = () =>
      api(`/parcel-tracking/${token}`)
        .then(setData)
        .catch((e) => setError(e.message));
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [token]);
  return (
    <div className="box">
      <h1 className="title is-3">Seguimiento de paquetería</h1>
      {error && <p>{error}</p>}
      {data && (
        <>
          <p>
            {data.origin} → {data.destination}
          </p>
          <p className="mt-3">
            <span className="tag is-primary">{parcelLabels[data.status]}</span>
            {Boolean(data.is_demo) && (
              <span className="tag is-warning ml-2">DEMO</span>
            )}
          </p>
          <p className="mt-3">
            Salida: {date(data.departure_at)} · Llegada estimada:{" "}
            {date(data.arrival_at)}
          </p>
          <ol className="parcel-timeline">
            {data.events.map((e, i) => (
              <li key={i}>
                <strong>{parcelLabels[e.status]}</strong>
                <small>{date(e.created_at)}</small>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
export default function Parcels({ user }) {
  const staff = ["admin", "cashier"].includes(user.role),
    [catalog, setCatalog] = useState(null),
    [settings, setSettings] = useState(null),
    [rows, setRows] = useState([]),
    [cash, setCash] = useState(null),
    [v, setV] = useState({
      tripId: "",
      senderName: user.name,
      senderPhone: user.phone,
      recipientName: "",
      recipientPhone: "",
      description: "",
      grams: 1000,
      lengthCm: 20,
      widthCm: 20,
      heightCm: 20,
      declaredCents: 0,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(null),
    [codes, setCodes] = useState({});
  const attempt = useRef(null);
  async function load() {
    try {
      const [c, s, r] = await Promise.all([
        api("/catalog"),
        api("/parcels/settings"),
        api("/parcels"),
      ]);
      setCatalog(c);
      setSettings(s);
      setRows(r);
      if (staff) setCash(await api("/cash"));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(
      () =>
        api("/parcels")
          .then(setRows)
          .catch(() => {}),
      15000,
    );
    return () => clearInterval(timer);
  }, []);
  const active = cash?.sessions.find(
      (s) => !s.closed_at && s.cashier_id === user.id,
    ),
    selected = catalog?.trips.find((t) => t.id === v.tripId),
    estimated = settings
      ? settings.base_cents +
        Math.ceil(Math.max(0, v.grams - settings.included_grams) / 1000) *
          settings.extra_kg_cents
      : 0;
  async function action(p, action) {
    setBusy(true);
    setError("");
    try {
      await api(`/parcels/${p.id}/action`, {
        method: "POST",
        body: {
          action,
          ...(action === "receive" ? { cashSessionId: active?.id } : {}),
          ...(action === "deliver" ? { pickupCode: codes[p.id] || "" } : {}),
        },
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="parcel-heading">
        <div>
          <p className="eyebrow">CONEXIONES TAMBIÉN LLEVA TUS ENVÍOS</p>
          <h1 className="title">Paquetería</h1>
          <p>De taquilla a taquilla, con seguimiento y entrega por código.</p>
        </div>
        <span aria-hidden="true">📦</span>
      </div>
      {error && (
        <p className="notification is-danger is-light" role="alert">
          {error}
        </p>
      )}
      {user.role !== "driver" && (
        <form
          className="box"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const fingerprint = JSON.stringify(v);
              if (attempt.current?.fingerprint !== fingerprint)
                attempt.current = { fingerprint, key: crypto.randomUUID() };
              const p = await api("/parcels", {
                method: "POST",
                body: v,
                key: attempt.current.key,
              });
              setReceipt(p);
              await load();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="title is-4">Solicitar un envío</h2>
          <p className="muted mb-4">
            La solicitud reserva carga por 60 minutos. Lleva el paquete a
            taquilla para revisión, recepción y pago. En las salidas DEMO puedes
            simular la recepción desde aquí.
          </p>
          <div className="columns is-multiline">
            <label className="column is-full">
              Salida
              <div className="select is-fullwidth">
                <select
                  required
                  value={v.tripId}
                  onChange={(e) => setV({ ...v, tripId: e.target.value })}
                >
                  <option value="">Selecciona ruta y salida</option>
                  {catalog?.trips
                    .filter((t) => t.cargo_packages > 0)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.demo ? "DEMO · " : ""}
                        {t.origin} → {t.destination} · {date(t.departure_at)} ·{" "}
                        {t.plate}
                      </option>
                    ))}
                </select>
              </div>
            </label>
            {staff && (
              <label className="column is-full">
                Cliente
                <div className="select is-fullwidth">
                  <select
                    required
                    value={v.customerId || ""}
                    onChange={(e) => {
                      const c = cash.customers.find(
                        (c) => c.id === e.target.value,
                      );
                      setV({
                        ...v,
                        customerId: e.target.value,
                        senderName: c?.name || "",
                      });
                    }}
                  >
                    <option value="">Selecciona cliente</option>
                    {cash?.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.email}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            )}
            {[
              ["senderName", "Nombre del remitente"],
              ["senderPhone", "Teléfono del remitente"],
              ["recipientName", "Nombre de quien recibe"],
              ["recipientPhone", "Teléfono de quien recibe"],
              ["description", "¿Qué contiene?"],
            ].map(([k, label]) => (
              <label
                className={`column ${k === "description" ? "is-full" : "is-half"}`}
                key={k}
              >
                {label}
                <input
                  required
                  className="input"
                  minLength={k.includes("Phone") ? 8 : 3}
                  maxLength={
                    k === "description" ? 250 : k.includes("Phone") ? 25 : 120
                  }
                  value={v[k]}
                  onChange={(e) => setV({ ...v, [k]: e.target.value })}
                />
              </label>
            ))}
            {[
              ["grams", "Peso (kg)", settings?.max_grams],
              ["lengthCm", "Largo (cm)", settings?.max_side_cm],
              ["widthCm", "Ancho (cm)", settings?.max_side_cm],
              ["heightCm", "Alto (cm)", settings?.max_side_cm],
              [
                "declaredCents",
                "Valor declarado (MXN)",
                settings?.max_declared_cents,
              ],
            ].map(([k, label, max]) => (
              <label className="column is-one-third" key={k}>
                {label}
                <input
                  required
                  className="input"
                  type="number"
                  min={k === "declaredCents" ? 0 : k === "grams" ? 0.001 : 1}
                  step={
                    k === "grams" ? 0.001 : k === "declaredCents" ? 0.01 : 1
                  }
                  max={
                    max /
                    (k === "grams" ? 1000 : k === "declaredCents" ? 100 : 1)
                  }
                  value={
                    v[k] /
                    (k === "grams" ? 1000 : k === "declaredCents" ? 100 : 1)
                  }
                  onChange={(e) =>
                    setV({
                      ...v,
                      [k]: Math.round(
                        Number(e.target.value) *
                          (k === "grams"
                            ? 1000
                            : k === "declaredCents"
                              ? 100
                              : 1),
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="parcel-price">
            <strong>Estimado: {money(estimated)}</strong>
            {selected?.demo ? (
              <span className="tag is-warning">Tarifa de demostración</span>
            ) : null}
          </div>
          <button disabled={busy} className="button is-primary">
            Registrar solicitud
          </button>
          <p className="help mt-3">
            No se admiten sustancias peligrosas ni artículos ilegales. El valor
            declarado es informativo; confirma condiciones en taquilla.
          </p>
        </form>
      )}
      {receipt && (
        <div className="notification is-success is-light">
          <strong>
            Solicitud {receipt.id.slice(0, 8)} creada ·{" "}
            {money(receipt.total_cents)}
          </strong>
          <p>
            Conserva el código de entrega: <b>{receipt.pickup_code}</b>.
            Compártelo únicamente con la persona que recogerá el paquete.
          </p>
          <a href={`/parcel-tracking/${receipt.tracking_token}`}>
            Abrir seguimiento
          </a>
          <button
            className="button is-small ml-3"
            onClick={() => {
              setReceipt(null);
              attempt.current = null;
              setV({ ...v, description: "" });
            }}
          >
            Otro envío
          </button>
        </div>
      )}
      <h2 className="title is-4">
        {staff
          ? "Envíos en taquilla"
          : user.role === "driver"
            ? "Carga asignada"
            : "Mis envíos"}
      </h2>
      {!rows.length && <div className="box">Aún no hay envíos.</div>}
      {rows.map((p) => (
        <article className="box parcel-card" key={p.id}>
          <div className="parcel-card-title">
            <h3>
              {p.origin} → {p.destination}
            </h3>
            <span className="tag is-light">{parcelLabels[p.status]}</span>
            {Boolean(p.is_demo) && <span className="tag is-warning">DEMO</span>}
          </div>
          <p>
            {p.description} · {p.grams / 1000} kg · {money(p.total_cents)}
          </p>
          <p className="muted">
            Salida {date(p.departure_at)} · Folio {p.id.slice(0, 8)}
          </p>
          <p>
            Remite: {p.sender_name} · {p.sender_phone}
            <br />
            Recibe: {p.recipient_name} · {p.recipient_phone}
          </p>
          {p.pickup_code && (
            <p className="mt-2">
              Código de entrega: <strong>{p.pickup_code}</strong>
            </p>
          )}
          <div className="buttons mt-3">
            <a
              className="button is-light is-small"
              href={`/parcel-tracking/${p.tracking_token}`}
            >
              Ver seguimiento
            </a>
            {p.status === "reserved" && staff && (
              <button
                disabled={!active || busy}
                className="button is-primary is-small"
                onClick={() => action(p, "receive")}
              >
                {p.is_demo
                  ? "Simular recepción y cobro en caja"
                  : "Recibir y cobrar en caja"}
              </button>
            )}
            {p.status === "reserved" &&
              Boolean(user.demo) &&
              p.user_id === user.id && (
                <button
                  disabled={busy}
                  className="button is-primary is-small"
                  onClick={() => action(p, "demo-receive")}
                >
                  Simular recepción y pago
                </button>
              )}
            {p.status === "received" &&
              ["driver", "admin"].includes(user.role) && (
                <button
                  disabled={busy || p.trip_status !== "boarding"}
                  className="button is-primary is-small"
                  onClick={() => action(p, "load")}
                >
                  Cargar a la unidad
                </button>
              )}
            {p.status === "arrived" && staff && (
              <>
                <input
                  className="input pickup-input"
                  aria-label={`Código de entrega ${p.id.slice(0, 8)}`}
                  placeholder="Código de 6 dígitos"
                  maxLength="6"
                  value={codes[p.id] || ""}
                  onChange={(e) =>
                    setCodes({
                      ...codes,
                      [p.id]: e.target.value.replace(/\D/g, ""),
                    })
                  }
                />
                <button
                  disabled={busy || (codes[p.id] || "").length !== 6}
                  className="button is-primary is-small"
                  onClick={() => action(p, "deliver")}
                >
                  Validar código y entregar
                </button>
              </>
            )}
            {p.status === "reserved" && p.user_id === user.id && (
              <button
                disabled={busy}
                className="button is-light is-small"
                onClick={() => action(p, "cancel")}
              >
                Cancelar solicitud
              </button>
            )}
          </div>
          {p.status === "reserved" && staff && !active && (
            <p className="help">
              Abre tu caja en Taquilla para recibir el paquete.
            </p>
          )}
        </article>
      ))}
    </>
  );
}
