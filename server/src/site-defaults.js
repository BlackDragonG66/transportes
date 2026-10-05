export const defaultSettings = {
  logoUrl: "/brand/logo.jpg",
  heroImageUrl: "/brand/hero-morelia.webp",
  announcement: "Apatzingán · Morelia · Aeropuerto · CREE / Teletón",
  heroEyebrow: "VIAJES QUE NOS ACERCAN",
  heroTitle: "Tu destino empieza con una buena conexión.",
  heroSubtitle:
    "Viaja entre Apatzingán y Morelia con comodidad, atención cercana y espacio para lo que importa.",
  promotionsTitle: "Hay una conexión para ti",
  promotionsSubtitle: "Conoce nuestros servicios, beneficios y promociones.",
  phones: ["4531523552", "4531261586", "4432222600"],
  facebookUrl: "https://www.facebook.com/",
  offices: [
    {
      city: "Apatzingán",
      address: "Av. 22 de Octubre #328, Col. Adolfo Ruiz Cortínez",
    },
    {
      city: "Morelia",
      address: "Calzada La Huerta #2060, Fraccionamiento Cosmos",
    },
  ],
  faqs: [
    {
      question: "¿Puedo elegir un asiento?",
      answer:
        "Reservamos lugares disponibles en la unidad. La asignación se realiza durante el abordaje.",
    },
    {
      question: "¿Cómo solicito un auto al llegar?",
      answer:
        "Después de confirmar el pago, abre tu boleto y solicita Viaje Rápido. Indica tu colonia o zona, pasajeros y maletas. Te avisaremos cuando un chofer acepte.",
    },
    {
      question: "¿Hay tarifas especiales?",
      answer:
        "Sí. Al capturar a cada pasajero verás las tarifas disponibles para adultos, niños, personas mayores y viajes inclusivos.",
    },
    {
      question: "¿Puedo pagar en taquilla?",
      answer:
        "Sí. Contacta a nuestras oficinas. Las compras en taquilla no tienen comisión web.",
    },
  ],
};
export const defaultPromotions = [
  [
    "00000001-0000-4000-8000-000000000001",
    "Conecta con tu próximo destino",
    "Rutas interurbanas, aeropuerto y envío de paquetes.",
    "/brand/banner-1.jpg",
    "banner",
  ],
  [
    "00000001-0000-4000-8000-000000000002",
    "Viaja cómodo",
    "Disfruta el camino con ConexionES.",
    "/brand/publi-1.jpg",
    "promotion",
  ],
  [
    "00000001-0000-4000-8000-000000000003",
    "Vive la diferencia",
    "Atención cercana en cada conexión.",
    "/brand/publi-2.jpg",
    "promotion",
  ],
  [
    "00000001-0000-4000-8000-000000000004",
    "Beneficios INAPAM",
    "Consulta las condiciones y tarifas en taquilla.",
    "/brand/publi-3.jpg",
    "promotion",
  ],
  [
    "00000001-0000-4000-8000-000000000005",
    "Mamás de Corazón",
    "Viajes inclusivos a CREE y Teletón. Consulta disponibilidad.",
    "/brand/publi-4.jpg",
    "promotion",
  ],
  [
    "00000001-0000-4000-8000-000000000006",
    "Llega a tiempo y con estilo",
    "Tu conexión con Morelia.",
    "/brand/publi-5.jpg",
    "promotion",
  ],
  [
    "00000001-0000-4000-8000-000000000007",
    "Viaja sin preocupaciones",
    "Acercamos a tu familia a lo que importa.",
    "/brand/publi-6.jpg",
    "promotion",
  ],
  [
    "00000001-0000-4000-8000-000000000008",
    "Conexiones que incluyen",
    "Una comunidad que viaja y crece junta.",
    "/brand/publi-7.jpg",
    "promotion",
  ],
];
export async function seedSite(db) {
  await db.query(
    "INSERT INTO site_settings(id,settings) VALUES('main',$1) ON DUPLICATE KEY UPDATE id=id",
    [JSON.stringify(defaultSettings)],
  );
  for (const [i, p] of defaultPromotions.entries())
    await db.query(
      "INSERT INTO site_promotions(id,title,subtitle,image_url,placement,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON DUPLICATE KEY UPDATE id=id",
      [...p, i],
    );
}
