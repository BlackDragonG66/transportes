import { useEffect, useState } from "react";
import { api, money, date } from "./api.js";
import ReservationForm from "./ReservationForm.jsx";
import StaffConfirm from "./StaffConfirm.jsx";
export default function POS({ user, view = "all", onNavigate }) {
  const [closing, setClosing] = useState(null);
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
  const active = data?.sessions.find(
    (s) => !s.closed_at && s.cashier_id === user.id,
  );
  useEffect(() => {
    if (view !== "reportes" || !data?.sessions.length) return;
    const session = active || data.sessions[0];
    let mounted = true;
    api(`/cash/${session.id}/report`)
      .then((r) => {
        if (mounted) setReport(r);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, [view, data]);
  async function action(path, body) {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, { method: "POST", body });
      if (path.includes("close")) setReport(r);
      setClosing(null);
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
      <h2 className="title is-4">
        {{
          caja: "Mi caja y turno",
          ventas: "Venta en taquilla",
          reportes: "Reportes y cortes",
        }[view] || "Taquilla"}
      </h2>
      {view === "ventas" && !active && (
        <div className="notification is-warning">
          Abre tu caja antes de vender boletos.{" "}
          <button
            className="button is-small ml-3"
            onClick={() => onNavigate?.("caja")}
          >
            Ir a mi caja
          </button>
        </div>
      )}
      {activation && (
        <p className="notification is-info is-light">
          Cliente DEMO registrado.{" "}
          <a href={activation}>Activar su acceso de ejemplo</a>
        </p>
      )}
      {error && <p className="notification is-danger is-light">{error}</p>}
      {(view === "all" || view === "caja") && (
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
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const r = await api(`/cash/${active.id}/report`);
                    setClosing({
                      sessionId: active.id,
                      counted: Math.round(Number(counted) * 100),
                      expected: r.opening_cents + r.sales_cents,
                    });
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
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
                  Revisar cierre de caja
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    try {
                      setReport(await api(`/cash/${active.id}/report`));
                      onNavigate?.("reportes");
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
      )}
      {active && (view === "all" || view === "ventas") && (
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
      {report && (view === "all" || view === "reportes") && (
        <div className="box">
          <h2 className="title is-4">
            {report.closed_at ? "Corte de turno" : "Reporte de caja abierta"}
          </h2>
          <p>
            Ventas: {money(report.salesCents ?? report.sales_cents)} · Esperado:{" "}
            {money(
              report.expected_cents ??
                report.opening_cents + report.sales_cents,
            )}
          </p>
          {report.closed_at ? (
            <p>
              Contado: {money(report.counted_cents || 0)} · Diferencia:{" "}
              {money(report.difference_cents || 0)}
            </p>
          ) : (
            <p>Turno abierto · Conteo y diferencia pendientes al cerrar.</p>
          )}
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
      {(view === "all" || view === "reportes") && (
        <>
          <h2 className="title is-5">Turnos recientes</h2>
          {data.sessions.map((s) => (
            <p className="mb-2" key={s.id}>
              {s.cashier_name} · {s.register_name} · {date(s.opened_at)} ·{" "}
              {s.closed_at ? "Cerrado" : "Abierto"}{" "}
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
          {!data.sessions.length && <p>No hay turnos registrados todavía.</p>}
        </>
      )}
      {closing && (
        <StaffConfirm
          title="Cerrar caja y generar corte"
          busy={busy}
          onCancel={() => setClosing(null)}
          onConfirm={() =>
            action(`/cash/${closing.sessionId}/close`, {
              countedCents: closing.counted,
            })
          }
        >
          <p>
            Esperado: <strong>{money(closing.expected)}</strong>
          </p>
          <p>
            Efectivo contado: <strong>{money(closing.counted)}</strong>
          </p>
          <p>
            Diferencia:{" "}
            <strong>{money(closing.counted - closing.expected)}</strong>
          </p>
          <p className="mt-3">
            Confirma el conteo para cerrar tu turno y guardar el corte.
          </p>
          {error && <p className="help is-danger">{error}</p>}
        </StaffConfirm>
      )}
    </>
  );
}
