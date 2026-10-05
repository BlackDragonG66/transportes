import { useEffect, useState } from "react";
import { api } from "./api.js";
const starter = {
  title: "",
  subtitle: "",
  image_url: "/brand/banner-1.jpg",
  button_label: "Consultar viaje",
  href: "#reservar",
  placement: "promotion",
  sort_order: 0,
  active: true,
  starts_at: null,
  ends_at: null,
};
const originalImages = [
  { url: "/brand/logo.jpg", filename: "Logo ConexionES" },
  { url: "/brand/hero-morelia.webp", filename: "Portada Morelia" },
  { url: "/brand/banner-1.jpg", filename: "Banner original" },
  ...Array.from({ length: 7 }, (_, i) => ({
    url: `/brand/publi-${i + 1}.jpg`,
    filename: `Publicidad ${i + 1}`,
  })),
];
const localTime = (v) =>
  v
    ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
function ImagePicker({ label, value, onChange, media }) {
  return (
    <label className="label">
      {label}
      <div className="image-picker">
        <img src={value} alt={`Vista previa: ${label}`} />
        <div className="select is-fullwidth">
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            {media.map((a) => (
              <option key={a.url} value={a.url}>
                {a.filename}
              </option>
            ))}
          </select>
        </div>
      </div>
    </label>
  );
}
export default function ContentAdmin({ onChanged }) {
  const [data, setData] = useState(null),
    [media, setMedia] = useState(originalImages),
    [editing, setEditing] = useState(null),
    [values, setValues] = useState(starter),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [site, assets] = await Promise.all([
      api("/admin/site"),
      api("/admin/media"),
    ]);
    setData(site);
    setMedia([...originalImages, ...assets]);
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function action(fn) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage("Cambios guardados.");
      await load();
      onChanged?.();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setMessage("La imagen debe pesar menos de 4 MB.");
      return;
    }
    setBusy(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const asset = await api("/admin/media", {
        method: "POST",
        body: { filename: file.name.slice(0, 120), base64 },
      });
      setMedia((old) => [...old.filter((m) => m.url !== asset.url), asset]);
      setMessage(
        `Imagen disponible: ${asset.filename}. Selecciónala en la portada o en un anuncio.`,
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  if (!data) return <p>{message || "Cargando contenido…"}</p>;
  const s = data.settings,
    set = (key, value) =>
      setData({ ...data, settings: { ...s, [key]: value } });
  return (
    <>
      <div className="box">
        <h2 className="title is-4">Biblioteca de imágenes</h2>
        <p className="muted mb-3">
          JPG, PNG o WebP · hasta 4 MB. Las imágenes quedan guardadas en la base
          de datos.
        </p>
        <label className="button is-light upload-button">
          Subir una imagen
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={upload}
          />
        </label>
        <div className="media-grid">
          {media.map((a) => (
            <figure key={a.url}>
              <img src={a.url} alt={a.filename} loading="lazy" />
              <figcaption>{a.filename}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      {message && (
        <p role="status" className="notification">
          {message}
        </p>
      )}
      <form
        className="box"
        onSubmit={(e) => {
          e.preventDefault();
          action(() => api("/admin/site", { method: "PUT", body: s }));
        }}
      >
        <h2 className="title is-4">Portada y contacto</h2>
        <div className="columns">
          <div className="column">
            <ImagePicker
              label="Logo"
              value={s.logoUrl}
              onChange={(v) => set("logoUrl", v)}
              media={media}
            />
          </div>
          <div className="column">
            <ImagePicker
              label="Imagen de portada"
              value={s.heroImageUrl}
              onChange={(v) => set("heroImageUrl", v)}
              media={media}
            />
          </div>
        </div>
        {[
          ["announcement", "Franja superior"],
          ["heroEyebrow", "Texto breve de portada"],
          ["heroTitle", "Título de portada"],
          ["heroSubtitle", "Descripción de portada"],
          ["promotionsTitle", "Título de promociones"],
          ["promotionsSubtitle", "Descripción de promociones"],
        ].map(([key, label]) => (
          <label className="label" key={key}>
            {label}
            <input
              className="input mt-2"
              required={key === "heroTitle"}
              maxLength={key === "heroSubtitle" ? 350 : 300}
              value={s[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
        <label className="label">
          Teléfonos (uno por línea)
          <textarea
            className="textarea"
            value={s.phones.join("\n")}
            onChange={(e) => set("phones", e.target.value.split("\n"))}
          />
        </label>
        <div className="columns">
          {s.offices.map((o, i) => (
            <div className="column" key={i}>
              <label className="label">
                Ciudad
                <input
                  className="input"
                  required
                  value={o.city}
                  onChange={(e) =>
                    set(
                      "offices",
                      s.offices.map((v, j) =>
                        j === i ? { ...v, city: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label className="label">
                Dirección
                <textarea
                  className="textarea"
                  required
                  value={o.address}
                  onChange={(e) =>
                    set(
                      "offices",
                      s.offices.map((v, j) =>
                        j === i ? { ...v, address: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <h3 className="title is-5 mt-5">Preguntas frecuentes</h3>
        {s.faqs.map((f, i) => (
          <div className="content-faq" key={i}>
            <input
              aria-label={`Pregunta ${i + 1}`}
              className="input"
              required
              value={f.question}
              onChange={(e) =>
                set(
                  "faqs",
                  s.faqs.map((v, j) =>
                    j === i ? { ...v, question: e.target.value } : v,
                  ),
                )
              }
            />
            <textarea
              aria-label={`Respuesta ${i + 1}`}
              className="textarea mt-2"
              required
              value={f.answer}
              onChange={(e) =>
                set(
                  "faqs",
                  s.faqs.map((v, j) =>
                    j === i ? { ...v, answer: e.target.value } : v,
                  ),
                )
              }
            />
            <button
              className="button is-small is-light mt-2"
              type="button"
              onClick={() =>
                set(
                  "faqs",
                  s.faqs.filter((_, j) => j !== i),
                )
              }
            >
              Quitar pregunta
            </button>
          </div>
        ))}
        <div className="buttons mt-4">
          <button
            type="button"
            className="button is-light"
            disabled={s.faqs.length >= 12}
            onClick={() =>
              set("faqs", [...s.faqs, { question: "", answer: "" }])
            }
          >
            Agregar pregunta
          </button>
          <button className="button is-primary" disabled={busy}>
            Guardar portada y contacto
          </button>
        </div>
      </form>
      <div className="box">
        <div className="section-heading">
          <h2>Anuncios y promociones</h2>
          <button
            className="button is-primary"
            onClick={() => {
              setEditing("new");
              setValues(starter);
            }}
          >
            Nuevo anuncio
          </button>
        </div>
        <div className="ad-admin-grid">
          {data.promotions.map((p) => (
            <article key={p.id}>
              <img src={p.image_url} alt={p.title} />
              <div>
                <strong>{p.title}</strong>
                <p>
                  Orden {p.sort_order} · {p.active ? "Publicado" : "Oculto"} ·{" "}
                  {p.placement === "banner" ? "Banner" : "Promoción"}
                </p>
                <button
                  className="button is-small"
                  onClick={() => {
                    setEditing(p.id);
                    setValues(
                      Object.fromEntries(
                        Object.keys(starter).map((k) => [
                          k,
                          k === "active"
                            ? Boolean(p[k])
                            : k.endsWith("_at")
                              ? p[k]
                                ? new Date(p[k]).toISOString()
                                : null
                              : p[k],
                        ]),
                      ),
                    );
                  }}
                >
                  Editar anuncio
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      {editing && (
        <form
          className="box"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await api(
                editing === "new"
                  ? "/admin/promotions"
                  : `/admin/promotions/${editing}`,
                { method: editing === "new" ? "POST" : "PUT", body: values },
              );
              setEditing(null);
            });
          }}
        >
          <h2 className="title is-4">
            {editing === "new" ? "Nuevo anuncio" : "Editar anuncio"}
          </h2>
          <ImagePicker
            label="Imagen del anuncio"
            value={values.image_url}
            onChange={(v) => setValues({ ...values, image_url: v })}
            media={media}
          />
          {[
            ["title", "Título"],
            ["subtitle", "Descripción"],
            ["button_label", "Texto del botón"],
            ["href", "Enlace del botón"],
          ].map(([key, label]) => (
            <label key={key} className="label">
              {label}
              <input
                required={key !== "subtitle"}
                className="input"
                value={values[key]}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <div className="columns">
            <div className="column">
              <label className="label">
                Ubicación
                <div className="select is-fullwidth">
                  <select
                    value={values.placement}
                    onChange={(e) =>
                      setValues({ ...values, placement: e.target.value })
                    }
                  >
                    <option value="banner">Banner destacado</option>
                    <option value="promotion">Promociones</option>
                  </select>
                </div>
              </label>
            </div>
            <div className="column">
              <label className="label">
                Orden
                <input
                  required
                  className="input"
                  type="number"
                  min="-1000"
                  max="1000"
                  value={values.sort_order}
                  onChange={(e) =>
                    setValues({ ...values, sort_order: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            {[
              ["starts_at", "Publicar desde"],
              ["ends_at", "Publicar hasta"],
            ].map(([key, label]) => (
              <div className="column" key={key}>
                <label className="label">
                  {label}
                  <input
                    type="datetime-local"
                    className="input"
                    value={localTime(values[key])}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [key]: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) =>
                setValues({ ...values, active: e.target.checked })
              }
            />{" "}
            Visible en el sitio
          </label>
          <p className="help">
            Las fechas usan la hora de este dispositivo. Desactiva el anuncio
            para ocultarlo sin perderlo.
          </p>
          <div className="buttons mt-4">
            <button className="button is-primary" disabled={busy}>
              Guardar anuncio
            </button>
            <button
              type="button"
              className="button is-light"
              onClick={() => setEditing(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </>
  );
}
