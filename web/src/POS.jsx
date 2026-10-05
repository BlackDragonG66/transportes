import { useEffect, useState } from "react";
import { api, money, date } from "./api.js";
import ReservationForm from "./ReservationForm.jsx";
export default function POS({ user }) {
  const [data, setData] = useState(null),
    [register, setRegister] = useState(""),
    [opening, setOpening] = useState("0"),
    [counted, setCounted] = useState("0"),
    [error, setError] = useState(""),
    [report, setReport] = useState(null),
    [busy, setBusy] = useState(false),
    [activation, setActivation] = useState(""),
    [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  async function load() {
    try {
      setData(await api("/cash"));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const active = data?.sessions.find((s) => !s.closed_at);
  async function action(path, body) {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, { method: "POST", body });
      if (path.includes("close")) setReport(r);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>Cargando taquilla… {error}</p>;
  return (
    <>
      <h1 className="title">Taquilla</h1>
      {activation && (
        <p className="notification is-info is-light">
          Cliente DEMO registrado.{" "}
          <a href={activation}>Activar su acceso de ejemplo</a>
        </p>
      )}
      {error && <p className="notification is-danger is-light">{error}</p>}
      <div className="box">
        {!active ? (
          <form
            className="cash-controls"
            onSubmit={(e) => {
              e.preventDefault();
              action("/cash/open", {
                registerId: register,
                openingCents: Math.round(Number(opening) * 100),
              });
            }}
          >
            <label>
              Caja
              <div className="select">
                <select
                  required
                  value={register}
                  onChange={(e) => setRegister(e.target.value)}
                >
                  <option value="">Selecciona caja</option>
                  {data.registers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              Fondo inicial MXN
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                required
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </label>
            <button disabled={busy} className="button is-primary">
              Abrir caja
            </button>
          </form>
        ) : (
          <>
            <p>
              Caja abierta desde {date(active.opened_at)} · Fondo{" "}
              {money(active.opening_cents)}
            </p>
            <form
              className="cash-controls mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                action(`/cash/${active.id}/close`, {
                  countedCents: Math.round(Number(counted) * 100),
                });
              }}
            >
              <label>
                Efectivo contado MXN
                <input
                  required
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
              </label>
              <button disabled={busy} className="button is-warning">
                Cerrar caja y generar corte
              </button>
              <button
                type="button"
                className="button"
                onClick={async () => {
                  try {
                    setReport(await api(`/cash/${active.id}/report`));
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Consultar ventas y esperado
              </button>
            </form>
          </>
        )}
      </div>
      {active && (
        <>
          <form
            className="box cash-controls"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const created = await api("/cash/customers", {
                  method: "POST",
                  body: customer,
                });
                setActivation(created.activationUrl || "");
                setCustomer({ name: "", email: "", phone: "" });
                await load();
                setError("");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {[
              ["name", "Nombre"],
              ["email", "Correo"],
              ["phone", "Teléfono"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  className="input"
                  required
                  type={key === "email" ? "email" : "text"}
                  value={customer[key]}
                  onChange={(e) =>
                    setCustomer({ ...customer, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <button disabled={busy} className="button">
              Registrar cliente
            </button>
          </form>
          <ReservationForm
            key={active.id}
            user={user}
            pos
            cashSession={active}
            customers={data.customers}
          />
        </>
      )}
      {report && (
        <div className="box">
          <h2 className="title is-4">Corte de turno</h2>
          <p>
            Ventas: {money(report.salesCents ?? report.sales_cents)} · Esperado:{" "}
            {money(
              report.expected_cents ??
                report.opening_cents + report.sales_cents,
            )}
          </p>
          <p>
            Contado: {money(report.counted_cents || 0)} · Diferencia:{" "}
            {money(report.difference_cents || 0)}
          </p>
          {report.sales && (
            <div className="table-container">
              <table className="table is-fullwidth">
                <thead>
                  <tr>
                    <th>Concepto / folio</th>
                    <th>Pasajeros</th>
                    <th>Venta</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sales.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.concept} · {s.id.slice(0, 8)}
                      </td>
                      <td>{s.passengers}</td>
                      <td>{money(s.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <h2 className="title is-5">Turnos recientes</h2>
      {data.sessions.map((s) => (
        <p className="mb-2" key={s.id}>
          {date(s.opened_at)} · {s.closed_at ? "Cerrado" : "Abierto"}{" "}
          <button
            className="button is-small"
            onClick={async () => {
              try {
                setReport(await api(`/cash/${s.id}/report`));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Ver reporte
          </button>
        </p>
      ))}
    </>
  );
}
