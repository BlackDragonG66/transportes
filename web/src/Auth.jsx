import { useState } from "react";
import { api } from "./api.js";
export function Auth({ onUser, loginOnly = false, title }) {
  const [register, setRegister] = useState(false),
    [values, setValues] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onUser(
        await api(`/auth/${register ? "register" : "login"}`, {
          method: "POST",
          body: values,
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="box auth-box" onSubmit={submit}>
      <h2 className="title is-4">
        {title || (register ? "Crea tu cuenta" : "Bienvenido de nuevo")}
      </h2>
      {(register
        ? ["name", "phone", "email", "password"]
        : ["email", "password"]
      ).map((key) => (
        <label className="field is-block" key={key}>
          {
            {
              name: "Nombre",
              phone: "Teléfono",
              email: "Correo",
              password: "Contraseña (mínimo 12 caracteres)",
            }[key]
          }
          <input
            className="input mt-1"
            required
            type={
              key === "password"
                ? "password"
                : key === "email"
                  ? "email"
                  : key === "phone"
                    ? "tel"
                    : "text"
            }
            minLength={key === "password" ? 12 : undefined}
            maxLength={key === "password" ? 72 : 120}
            autoComplete={
              key === "password"
                ? register
                  ? "new-password"
                  : "current-password"
                : key === "name"
                  ? "name"
                  : key === "phone"
                    ? "tel"
                    : "email"
            }
            value={values[key] || ""}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        </label>
      ))}
      {error && (
        <p role="alert" className="notification is-danger is-light">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notification">
          {notice}
        </p>
      )}
      <button
        disabled={busy}
        className={`button is-primary is-fullwidth ${busy ? "is-loading" : ""}`}
      >
        {register ? "Registrarme" : "Entrar"}
      </button>
      {!loginOnly && (
        <button
          className="button is-text mt-3"
          type="button"
          onClick={() => {
            setRegister(!register);
            setValues({});
            setError("");
          }}
        >
          {register ? "Ya tengo cuenta" : "Crear una cuenta"}
        </button>
      )}
      {!register && (
        <button
          type="button"
          className="button is-text"
          onClick={async () => {
            try {
              setNotice(
                (
                  await api("/auth/recover", {
                    method: "POST",
                    body: { email: values.email },
                  })
                ).message,
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Recuperar acceso
        </button>
      )}
    </form>
  );
}
export function Activate({ token, onUser }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="box auth-box"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onUser(
            await api("/auth/activate", {
              method: "POST",
              body: { token, password },
            }),
          );
          history.replaceState(null, "", "/");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="title is-4">Establece tu contraseña</h1>
      <label className="label">Mínimo 12 caracteres</label>
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        minLength="12"
        maxLength="72"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="notification is-danger is-light mt-3">{error}</p>}
      <button disabled={busy} className="button is-primary mt-4">
        Guardar y entrar
      </button>
    </form>
  );
}
