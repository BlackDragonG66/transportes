import { useEffect, useState } from "react";
import { api, date } from "./api.js";
export const roleNames = {
  admin: "Administrador",
  cashier: "Cajero",
  driver: "Conductor",
  customer: "Cliente",
};
const guides = {
  admin: [
    "Crea o revisa las salidas en Administración → Programar salidas.",
    "Consulta las unidades, conductores y sus QR. Revisa el corte de Esmeralda.",
  ],
  cashier: [
    "Abre una caja DEMO con un fondo de ejemplo.",
    "Vende un boleto a Ana o Luis desde Taquilla. Recibe y cobra paquetes en Paquetería.",
    "Al llegar la unidad, entrega los paquetes con el código del cliente. Cierra caja y revisa el corte.",
  ],
  driver: [
    "En Operación, los conductores de unidad ven sus salidas y listas de pasajeros.",
    "Inicia abordaje, valida boletos, carga paquetes, sal a ruta y registra llegada.",
    "Gabriel y Lucía eligen su auto, aceptan solicitudes de Viaje Rápido y completan el traslado.",
  ],
  customer: [
    "Elige una salida DEMO, captura los nombres y extras, y confirma el pago simulado.",
    "Abre el boleto para pedir tu taxi. Para cinco personas solicita al menos dos autos.",
    "En Paquetería crea un envío y simula su recepción o pide a Esmeralda que lo reciba. Comparte el seguimiento y conserva el código de entrega.",
  ],
};
export function DemoGuide({ user }) {
  if (!user?.demo) return null;
  return (
    <details className="demo-guide">
      <summary>
        Estás probando como {user.name} · {roleNames[user.role]}
      </summary>
      <ol>
        {guides[user.role].map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p>
        Las placas, teléfonos, horarios y tarifas de ejemplo están identificados
        como DEMO. El pago simulado no realiza un cargo.
      </p>
    </details>
  );
}
export function DemoAdmin({ onChanged }) {
  const [data, setData] = useState(null),
    [start, setStart] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setData(await api("/admin/demo"));
    } catch (e) {
      setMessage(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  function download() {
    const csv = [
      "Nombre,Perfil,Correo,Contraseña",
      ...result.credentials.map((a) =>
        [a.name, roleNames[a.role], a.email, a.password].join(","),
      ),
    ].join("\r\n");
    const u = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "accesos-demo-conexiones.csv";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <>
      <div className="box">
        <p className="eyebrow">RECORRIDO COMPLETO</p>
        <h2 className="title is-4">Demostración por perfiles</h2>
        <p>
          Genera 21 días de salidas: interurbanas y aeropuerto diariamente; CREE
          lunes y miércoles; Teletón martes y jueves. Crea a Jonathan,
          Esmeralda, Gabriel, cuatro conductores de unidad, otro taxi y dos
          clientes.
        </p>
        <p className="help">
          Repetir el mismo rango conserva las cuentas, contraseñas y salidas
          existentes. Los cobros de ejemplo tienen un registro separado.
        </p>
        <form
          className="demo-controls"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              const r = await api("/admin/demo/setup", {
                method: "POST",
                body: start ? { startDate: start } : {},
              });
              setResult(r);
              setMessage(
                `${r.tripsCreated} salidas nuevas. Periodo ${r.startDate} al ${r.endDate}.`,
              );
              await load();
              onChanged?.();
            } catch (e) {
              setMessage(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            ¿Desde qué día?{" "}
            <input
              className="input"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <small>Vacío: mañana, hora de Ciudad de México.</small>
          </label>
          <button
            disabled={busy}
            className={`button is-primary ${busy ? "is-loading" : ""}`}
          >
            Generar tres semanas DEMO
          </button>
        </form>
        {message && (
          <p className="notification mt-4" role="status">
            {message}
          </p>
        )}
        {data?.enabled && (
          <p>{data.upcoming} salidas futuras de demostración.</p>
        )}
      </div>
      {result?.credentials.length > 0 && (
        <div className="box">
          <h3 className="title is-5">Accesos recién creados</h3>
          <p>
            Descárgalos ahora. Las contraseñas se muestran únicamente al crear
            las cuentas.
          </p>
          <button className="button mt-3 mb-3" onClick={download}>
            Descargar accesos CSV
          </button>
          <div className="table-container">
            <table className="table is-fullwidth">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Perfil</th>
                  <th>Correo</th>
                  <th>Contraseña</th>
                </tr>
              </thead>
              <tbody>
                {result.credentials.map((a) => (
                  <tr key={a.email}>
                    <td>{a.name}</td>
                    <td>{roleNames[a.role]}</td>
                    <td>{a.email}</td>
                    <td>
                      <code>{a.password}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="box">
        <h3 className="title is-5">Cuentas de ejemplo</h3>
        <div className="table-container">
          <table className="table is-fullwidth">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Perfil</th>
                <th>Correo</th>
              </tr>
            </thead>
            <tbody>
              {data?.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{roleNames[a.role]}</td>
                  <td>{a.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ParcelSettings />
    </>
  );
}
function ParcelSettings() {
  const [value, setValue] = useState(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    api("/parcels/settings")
      .then(setValue)
      .catch((e) => setMessage(e.message));
  }, []);
  const fields = {
    base_cents: "Precio base (MXN)",
    included_grams: "Peso incluido (kg)",
    extra_kg_cents: "Cada kg adicional (MXN)",
    max_grams: "Peso máximo por paquete (kg)",
    max_side_cm: "Lado máximo (cm)",
    max_declared_cents: "Valor declarado máximo (MXN)",
  };
  return (
    value && (
      <form
        className="box"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const { id, ...body } = value;
            setValue(
              await api("/admin/parcels/settings", { method: "PUT", body }),
            );
            setMessage("Tarifas de paquetería guardadas.");
          } catch (e) {
            setMessage(e.message);
          }
        }}
      >
        <h3 className="title is-5">Tarifas y límites de paquetería</h3>
        <div className="columns is-multiline">
          {Object.entries(fields).map(([key, label]) => (
            <label className="column is-half" key={key}>
              {label}
              <input
                required
                className="input"
                type="number"
                min="0"
                step={
                  key.endsWith("cents")
                    ? 0.01
                    : key.endsWith("grams")
                      ? 0.001
                      : 1
                }
                value={
                  value[key] /
                  (key.endsWith("cents")
                    ? 100
                    : key.endsWith("grams")
                      ? 1000
                      : 1)
                }
                onChange={(e) =>
                  setValue({
                    ...value,
                    [key]: Math.round(
                      Number(e.target.value) *
                        (key.endsWith("cents")
                          ? 100
                          : key.endsWith("grams")
                            ? 1000
                            : 1),
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
        <button className="button is-primary">Guardar tarifas</button>
        {message && <p role="status">{message}</p>}
      </form>
    )
  );
}
export function Notices() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const load = () =>
      api("/notifications")
        .then(setRows)
        .catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="box">
      <h1 className="title is-4">Mis avisos</h1>
      <p className="mb-4">
        Aquí también recibes las confirmaciones y asignaciones aunque el correo
        esté pendiente de configuración.
      </p>
      {rows.map((n) => (
        <article className="notice-card" key={n.id}>
          <strong>{n.title}</strong>
          <small>{date(n.created_at)}</small>
          <p>{n.body}</p>
          <a href={n.url}>Ver detalle →</a>
        </article>
      ))}
      {!rows.length && <p>Aún no hay avisos.</p>}
    </div>
  );
}
