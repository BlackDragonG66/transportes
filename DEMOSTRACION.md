# ConexionES: demostración por perfiles

La instalación se realiza con una cuenta administradora en **Administración → Demostración y paquetería**. Genera diez cuentas, cuatro unidades, dos autos locales, dos cajas y 150 salidas durante 21 días. Las contraseñas únicas se entregan una vez y se pueden descargar; repetir la instalación conserva los accesos y las salidas existentes.

Los registros DEMO tienen identificadores propios. Los pagos simulados se guardan en `demo_payments`, nunca en `payments`. Una caja DEMO admite únicamente salidas y clientes DEMO. Mercado Pago y su conciliación excluyen esos viajes. Los avisos aparecen en **Mis avisos** y pueden llegar por Web Push; no se envían correos a cuentas de demostración.

## Cuentas y vehículos

| Nombre | Correo de acceso | Perfil / asignación |
|---|---|---|
| Jonathan Garcia | jonathan@demo.conexiones.test | Administrador |
| Esmeralda | esmeralda@demo.conexiones.test | Cajera |
| Carlos Mendoza | carlos@demo.conexiones.test | Mercedes Benz Sprinter, 18 lugares |
| María Hernández | maria@demo.conexiones.test | Toyota Hiace, 14 lugares |
| Raúl Torres | raul@demo.conexiones.test | Toyota Hiace, aeropuerto |
| Patricia López | patricia@demo.conexiones.test | Mercedes Benz Sprinter, CREE / Teletón |
| Gabriel Guzman Rodriguez | gabriel@demo.conexiones.test | Hyundai Accent 2019 rojo, Uber, 4 pasajeros |
| Lucía Ramírez | lucia@demo.conexiones.test | Toyota Avanza blanco, taxi, 4 pasajeros |
| Ana Martínez | ana@demo.conexiones.test | Cliente |
| Luis Sánchez | luis@demo.conexiones.test | Cliente |

Los teléfonos `0000000000`, placas con prefijo DEMO y avatares de iniciales son ficticios. No representan documentos, fotografías ni contacto real.

## Recorrido

1. **Cliente:** Ana elige una salida Apatzingán → Morelia, captura los nombres, agrega complementos y confirma el pago simulado. El total incluye $10 MXN por pasajero en web. Desde el boleto solicita el auto; cinco viajeros requieren al menos dos autos.
2. **Cajera:** Esmeralda abre una caja DEMO con un fondo de ejemplo, vende un boleto a Luis sin comisión web y recibe paquetes. Puede consultar las ventas antes del cierre; el corte suma boletos y paquetería y compara el efectivo contado con el esperado.
3. **Conductor de unidad:** Carlos abre **Operación**, elige la fecha y consulta **Pasajeros y carga**. Inicia abordaje, valida los boletos y carga los paquetes recibidos. Al salir, los paquetes pasan a **En camino**; al registrar llegada, pasan a **Listo para recoger**.
4. **Uber / taxi:** Gabriel selecciona su Accent en **Operación**, acepta una solicitud según colonia, pasajeros y maletas. Solo después de aceptarla obtiene el nombre y teléfono del cliente. Lucía puede tomar el segundo auto. Cada chofer completa su traslado.
5. **Paquetería:** Ana solicita el envío y conserva su código privado de seis dígitos. Puede simular recepción y pago desde su perfil, o Esmeralda puede recibirlo y cobrarlo en caja. Carlos lo carga durante el abordaje. Después de llegar, taquilla verifica el código y registra la entrega. El enlace público muestra únicamente ruta, estados y tiempos.
6. **Administrador:** Jonathan puede configurar página, publicidad, tarifas, equipo y programación. **Programar salidas** pregunta ruta, unidad, conductor, fechas, días, horarios, duración, lugares y capacidad de carga. Presenta una revisión previa y crea el lote completo con una transacción; ante un conflicto no crea ninguna salida.

## Horarios de ejemplo, Ciudad de México

- Carlos: Apatzingán → Morelia 07:00, regreso 17:00, diariamente.
- María: Morelia → Apatzingán 08:00, regreso 16:00, diariamente.
- Raúl: Apatzingán → Aeropuerto de Morelia 06:00, regreso 15:00, diariamente.
- Patricia: CREE lunes y miércoles; Teletón martes y jueves. Ida 07:30 y regreso 15:30.

La demostración permite recorrer estados sin esperar al horario real. Los permisos de conductor, códigos e inventario siguen validándose.

## Paquetería

El inventario es independiente de los lugares: cada salida declara límite de paquetes y de peso. Las solicitudes sin recepción vencen en 60 minutos o al salir. Las salidas reales existentes no habilitan carga automáticamente; las nuevas salidas y el programador permiten capacidad de carga.

La tarifa inicial de ejemplo es $120 por hasta 5 kg, más $15 por kg adicional, máximo 30 kg y 100 cm por lado. Se configura en Administración. La solicitud calcula el importe en el servidor; el cobro real se realiza en taquilla. El valor declarado es informativo y no constituye una póliza de seguro.

## Validación

`npm test` usa una base MySQL efímera. Incluye carreras de capacidad, instalación repetida sin sobrescribir contraseñas, separación de caja y pago DEMO, programación atómica, permisos, recepción/carga/entrega y privacidad del seguimiento. GitHub Actions verifica también MariaDB.
