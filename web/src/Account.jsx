import { useState, useEffect } from "react";
import { api } from "./api.js";
export default function Account({ user }) {
  const [currentPassword, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="box auth-box"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          setMessage(
            (
              await api("/auth/password", {
                method: "POST",
                body: { currentPassword, password },
              })
            ).message,
          );
          setCurrent("");
          setPassword("");
        } catch (e) {
          setMessage(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="title is-4">Mi cuenta</h1>
      <p>
        {user.name}
        <br />
        {user.email}
      </p>
      <label className="label mt-4">
        Contraseña actual
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          required
          minLength="12"
          maxLength="72"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="label">
        Nueva contraseña
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          required
          minLength="12"
          maxLength="72"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="button is-primary" disabled={busy}>
        Cambiar contraseña
      </button>
      {message && (
        <p role="status" className="notification mt-4">
          {message}
        </p>
      )}
    </form>
  );
}
export function TeamAdmin() {
  const [rows, setRows] = useState([]),
    [v, setV] = useState({
      name: "",
      email: "",
      phone: "",
      password: "",
      role: "cashier",
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => api("/admin/users").then(setRows);
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  return (
    <div className="box">
      <h2 className="title is-4">Equipo y accesos</h2>
      <p className="muted">
        Crea cuentas para taquilla, conductores o administradores. Entrega su
        contraseña directamente a cada persona.
      </p>
      <form
        className="mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/admin/users", { method: "POST", body: v });
            setV({ ...v, name: "", email: "", phone: "", password: "" });
            setMessage("Cuenta creada.");
            await load();
          } catch (e) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="columns is-multiline">
          {[
            ["name", "Nombre", "text"],
            ["email", "Correo", "email"],
            ["phone", "Teléfono", "tel"],
            [
              "password",
              "Contraseña inicial (mínimo 12 caracteres)",
              "password",
            ],
          ].map(([key, label, type]) => (
            <div className="column is-half" key={key}>
              <label className="label">
                {label}
                <input
                  required
                  type={type}
                  className="input"
                  autoComplete={key === "password" ? "new-password" : "off"}
                  minLength={key === "password" ? 12 : undefined}
                  value={v[key]}
                  onChange={(e) => setV({ ...v, [key]: e.target.value })}
                />
              </label>
            </div>
          ))}
          <div className="column">
            <label className="label">
              Permisos
              <div className="select">
                <select
                  value={v.role}
                  onChange={(e) => setV({ ...v, role: e.target.value })}
                >
                  <option value="cashier">Taquilla</option>
                  <option value="driver">Conductor</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </label>
          </div>
        </div>
        <button disabled={busy} className="button is-primary">
          Crear acceso
        </button>
      </form>
      {message && (
        <p className="notification mt-3" role="status">
          {message}
        </p>
      )}
      {rows.map((r) => (
        <div className="fare-row" key={r.id}>
          <span>
            <strong>{r.name}</strong>
            <small>{r.email}</small>
          </span>
          <span>
            {
              {
                admin: "Administrador",
                cashier: "Taquilla",
                driver: "Conductor",
              }[r.role]
            }
          </span>
        </div>
      ))}
    </div>
  );
}
