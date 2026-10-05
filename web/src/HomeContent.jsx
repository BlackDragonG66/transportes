import { useState, useEffect } from "react";
import useModalFocus from "./useModalFocus.js";
export function HomeHero({ settings }) {
  return (
    <section
      className="home-hero"
      style={{
        backgroundImage: `linear-gradient(90deg,rgba(45,12,73,.9),rgba(45,12,73,.5) 40%,rgba(45,12,73,.03) 72%),url("${settings.heroImageUrl}")`,
      }}
    >
      <div className="hero-inner">
        <p className="eyebrow">{settings.heroEyebrow}</p>
        <h1>{settings.heroTitle}</h1>
        <p className="hero-copy">{settings.heroSubtitle}</p>
        <a className="hero-link" href="#reservar">
          Encuentra tu próxima salida <span>↘</span>
        </a>
      </div>
    </section>
  );
}
export function HomeContent({ site }) {
  const [selected, setSelected] = useState(null),
    [banner, setBanner] = useState(0);
  const banners = site.promotions.filter((p) => p.placement === "banner"),
    ads = site.promotions.filter((p) => p.placement === "promotion");
  useModalFocus(Boolean(selected), () => setSelected(null));
  useEffect(() => {
    const close = (e) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  const featured = banners[banner % banners.length];
  return (
    <>
      <section className="benefit-strip" aria-label="Beneficios">
        <div>
          <span>↔</span>
          <p>
            <strong>Más cerca de tu destino</strong>
            <small>Apatzingán y Morelia</small>
          </p>
        </div>
        <div>
          <span>♡</span>
          <p>
            <strong>Un viaje para todos</strong>
            <small>Tarifas y atención inclusivas</small>
          </p>
        </div>
        <div>
          <span>✓</span>
          <p>
            <strong>Compra con confianza</strong>
            <small>Boleto digital y datos de tu unidad</small>
          </p>
        </div>
        <div>
          <span>🚕</span>
          <p>
            <strong>Conecta al llegar</strong>
            <small>Solicita tu auto después del pago</small>
          </p>
        </div>
      </section>
      {featured && (
        <section className="campaign-banner">
          <button
            className="banner-image"
            onClick={() => setSelected(featured)}
            aria-label={`Ampliar ${featured.title}`}
          >
            <img src={featured.image_url} alt={featured.title} loading="lazy" />
          </button>
          <div>
            <p className="eyebrow">VIAJAMOS CONTIGO</p>
            <h2>{featured.title}</h2>
            <p>{featured.subtitle}</p>
            <a className="button is-primary" href={featured.href}>
              {featured.button_label}
            </a>
            {banners.length > 1 && (
              <div className="banner-dots">
                {banners.map((p, i) => (
                  <button
                    key={p.id}
                    aria-label={`Mostrar ${p.title}`}
                    aria-pressed={i === banner % banners.length}
                    onClick={() => setBanner(i)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}
      <section id="promociones" className="promotions-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DESCUBRE CONEXIONES</p>
            <h2>{site.settings.promotionsTitle}</h2>
            <p className="muted">{site.settings.promotionsSubtitle}</p>
          </div>
          <span>{ads.length} conexiones para descubrir</span>
        </div>
        <div className="promotion-grid">
          {ads.map((p) => (
            <article className="promotion-card" key={p.id}>
              <button
                className="poster-button"
                onClick={() => setSelected(p)}
                aria-label={`Ampliar ${p.title}`}
              >
                <img src={p.image_url} alt={p.title} loading="lazy" />
              </button>
              <div>
                <h3>{p.title}</h3>
                <p>{p.subtitle}</p>
                <a href={p.href}>
                  {p.button_label} <span>→</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section id="servicios" className="services-section">
        <div>
          <p className="eyebrow">ELIGE CÓMO CONECTAR</p>
          <h2>
            El camino cambia.
            <br />
            Nuestra atención permanece.
          </h2>
          <p>
            Viajes interurbanos, conexiones al aeropuerto y rutas médicas con la
            cercanía de ConexionES.
          </p>
        </div>
        <div className="service-cards">
          {[
            [
              "01",
              "Apatzingán ↔ Morelia",
              "Consulta las salidas publicadas y encuentra tu próxima conexión.",
            ],
            [
              "02",
              "Aeropuerto de Morelia",
              "Planea tu traslado al aeropuerto. Consulta disponibilidad antes de tu vuelo.",
            ],
            [
              "03",
              "CREE y Teletón",
              "Viajes inclusivos para acercarte a tu atención médica.",
            ],
            [
              "04",
              "Viaje Rápido",
              "Con tu boleto confirmado, solicita un auto para tu colonia o zona de llegada.",
            ],
            [
              "05",
              "Paquetería",
              "Envíos de taquilla a taquilla, seguimiento y entrega con código.",
            ],
          ].map(([n, title, text]) => (
            <article key={n}>
              <span>{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
                {n === "05" && (
                  <a className="service-parcel-link" href="/#parcels">
                    Solicitar un envío →
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section id="ayuda" className="faq-section">
        <div>
          <p className="eyebrow">VIAJA CON TRANQUILIDAD</p>
          <h2>Antes de salir</h2>
          <p className="muted">
            Resolvemos tus dudas para que disfrutes el camino.
          </p>
        </div>
        <div>
          {site.settings.faqs.map((f, i) => (
            <details key={i}>
              <summary>{f.question}</summary>
              <p>{f.answer}</p>
            </details>
          ))}
        </div>
      </section>
      {selected && (
        <div
          className="modal is-active"
          role="dialog"
          aria-modal="true"
          aria-label={selected.title}
        >
          <div className="modal-background" onClick={() => setSelected(null)} />
          <div className="modal-content poster-modal">
            <img src={selected.image_url} alt={selected.title} />
            <a
              className="button is-primary mt-3"
              href={selected.href}
              onClick={() => setSelected(null)}
            >
              {selected.button_label}
            </a>
          </div>
          <button
            autoFocus
            className="modal-close is-large"
            aria-label="Cerrar promoción"
            onClick={() => setSelected(null)}
          />
        </div>
      )}
    </>
  );
}
export function SiteFooter({ settings }) {
  return (
    <footer id="contacto" className="site-footer">
      <div className="footer-grid">
        <div>
          <a className="footer-brand" href="/">
            Conexion<span>ES</span>
          </a>
          <p>
            Viajes que nos acercan.
            <br />
            Apatzingán, Morelia y mucho más.
          </p>
        </div>
        <div>
          <h3>Hablemos de tu viaje</h3>
          {settings.phones.map((p) => (
            <a key={p} href={`tel:${p}`}>
              {p}
            </a>
          ))}
        </div>
        {settings.offices.map((o, i) => (
          <div key={i}>
            <h3>{o.city}</h3>
            <p>{o.address}</p>
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} ConexionES</span>
        <a href="#ayuda">Preguntas frecuentes</a>
        <span>Hecho para conectar</span>
      </div>
    </footer>
  );
}
