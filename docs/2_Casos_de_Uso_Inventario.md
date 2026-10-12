---
title: Casos de Uso — Microservicio de Inventario
sidebar_label: Casos de uso
sidebar_position: 2
slug: /casos-de-uso
---

# Casos de Uso — Microservicio de Inventario

Convención de eventos: `Microservicio.Entidad.Accion`. Este documento complementa a `1_Requisitos_Inventario.md`; cada Caso de Uso corresponde 1:1 con su Requisito Funcional del mismo número.

---

## CU-01 — Reservar inventario para nueva orden
**Relacionado:** RF-01
**Objetivo:** Apartar stock suficiente para garantizar que una orden pueda prepararse.
**Actor principal:** Microservicio de Órdenes/Cocina (evento)
**Actores secundarios:** Sistema de Inventario, Almacenista (notificado ante faltantes)

**Precondiciones:** El platillo tiene una receta registrada en Inventario (ver RF-11 / CU-11).
**Postcondiciones:** Stock disponible reducido por la cantidad reservada; registro de reserva creado con referencia a la orden.

**Flujo principal:**
1. Órdenes emite el evento `Ordenes.Orden.Creada` con el/los platillo(s) solicitados y sus cantidades.
2. Inventario obtiene los ingredientes requeridos consultando su registro interno de recetas (por `platillo_id`).
3. Inventario consulta el stock disponible por ingrediente y selecciona lotes aplicando FEFO.
4. Inventario valida que cada ingrediente tenga cantidad suficiente.
5. Inventario crea el registro de reserva (orden–platillo–lote–cantidad).
6. Inventario actualiza el stock disponible restando lo reservado.
7. Inventario emite el evento `Inventario.Reserva.Confirmada` a Órdenes.

**Flujos alternos:**
- A1: Ingrediente insuficiente → Inventario emite `Inventario.Reserva.Rechazada` con el detalle; Órdenes decide el siguiente paso.

**Flujos de excepción:**
- E1: Falla de comunicación al emitir la confirmación → reintento con backoff; la reserva queda "pendiente de confirmación" con expiración.
- E2: El platillo referenciado no tiene receta registrada en Inventario → se rechaza con error "receta no encontrada" (distinto de stock insuficiente).

**Reglas de negocio relacionadas:** Reserva todo-o-nada; FEFO obligatorio; la reserva nunca descuenta el stock físico total, solo el disponible.

---

## CU-02 — Descontar stock al servir una orden
**Relacionado:** RF-02
**Objetivo:** Reflejar el consumo real de ingredientes en el stock físico.
**Actor principal:** Microservicio de Órdenes/Cocina (evento `Ordenes.Orden.Servida`)
**Actores secundarios:** Sistema de Inventario

**Precondiciones:** Existe una reserva activa asociada a la orden.
**Postcondiciones:** Stock físico reducido; reserva cerrada; movimiento registrado en el log; posible disparo de CU-12 si alguna receta deja de ser preparable.

**Flujo principal:**
1. Órdenes emite el evento `Ordenes.Orden.Servida`.
2. Inventario localiza la reserva asociada a la orden.
3. Inventario descuenta la cantidad reservada del stock físico total, por lote.
4. Inventario cierra la reserva (estado "consumida").
5. Inventario registra el movimiento en el log de auditoría.
6. Inventario dispara la evaluación de disponibilidad de recetas afectadas (ver CU-12).

**Flujos alternos:**
- A1: No existe reserva activa para la orden → se registra inconsistencia y se notifica para revisión manual.

**Flujos de excepción:**
- E1: Evento `Ordenes.Orden.Servida` duplicado → se detecta por idempotencia (id de orden ya procesado) y se ignora.

**Reglas de negocio relacionadas:** Descuento irreversible; a partir de este estado, cualquier reingreso es merma, no devolución.

---

## CU-03 — Liberar reserva por cancelación
**Relacionado:** RF-03
**Actor principal:** Microservicio de Órdenes/Cocina (evento `Ordenes.Orden.Cancelada`)
**Actores secundarios:** Sistema de Inventario

**Precondiciones:** Existe una reserva activa no consumida para la orden.
**Postcondiciones:** Stock disponible restaurado; reserva cerrada como "liberada".

**Flujo principal:**
1. Órdenes emite `Ordenes.Orden.Cancelada`.
2. Inventario valida que la orden no esté en estado "Servida".
3. Inventario libera la reserva y suma la cantidad de vuelta al stock disponible.
4. Se registra el movimiento en el log.

**Flujos de excepción:**
- E1: Orden ya servida → se rechaza la liberación, se notifica que corresponde registrar merma (ver CU-04).

**Reglas de negocio relacionadas:** Solo procede liberación antes del punto de no retorno ("Servida").

---

## CU-04 — Registrar merma
**Relacionado:** RF-04
**Actor principal:** Almacenista
**Actores secundarios:** Sistema de Inventario, Órdenes (origen del estado de excepción)

**Precondiciones:** La orden está en estado "Servida" o "Excepción sin reingreso".
**Postcondiciones:** Registro de merma creado; stock disponible sin cambios.

**Flujo principal:**
1. Almacenista (o el sistema, en caso de excepción) identifica un consumo no recuperable.
2. Se registra la merma: cantidad, motivo, ingrediente/lote, orden de referencia.
3. Inventario almacena el registro en el log de auditoría y en el histórico de mermas.

**Flujos alternos:**
- A1: Merma originada automáticamente por resolución de un estado de excepción sin reingreso.

**Flujos de excepción:**
- E1: Intento de registrar merma sobre orden no servida → rechazo, redirección a flujo de cancelación (CU-03).

**Reglas de negocio relacionadas:** La merma no modifica el stock disponible; solo es registro contable/de control.

---

## CU-05 — Consultar disponibilidad de receta por platillo
**Relacionado:** RF-05 *(modificado)*
**Actor principal:** Microservicio de Órdenes/Cocina
**Actores secundarios:** Sistema de Inventario

**Precondiciones:** El platillo tiene una receta registrada en Inventario (RF-11).
**Postcondiciones:** Ninguna (consulta de solo lectura, no reserva stock).

**Flujo principal:**
1. Órdenes envía una solicitud síncrona indicando el `platillo_id`.
2. Inventario obtiene la receta registrada internamente para ese platillo.
3. Inventario consulta el stock disponible actual de cada ingrediente de la receta.
4. Inventario responde con disponibilidad general (sí/no) y detalle por ingrediente.

**Flujos de excepción:**
- E1: El `platillo_id` no tiene receta registrada → error controlado "receta no encontrada".
- E2: Timeout o falla del servicio → respuesta de error; Órdenes maneja reintento o degrada experiencia.

**Reglas de negocio relacionadas:** Esta consulta no reserva stock (ver CU-01); es solo informativa.

---

## CU-06 — Aplicar regla FEFO en consumo de stock
**Relacionado:** RF-06
**Actor principal:** Sistema de Inventario (proceso interno, invocado por CU-01/CU-02)
**Actores secundarios:** Administrador (registra lotes), Almacenista

**Precondiciones:** Existen uno o más lotes activos y vigentes para el ingrediente.
**Postcondiciones:** El/los lote(s) más próximos a vencer quedan con su cantidad reducida primero.

**Flujo principal:**
1. Se solicita una cantidad X de un ingrediente (desde reserva o descuento).
2. El sistema ordena los lotes vigentes por fecha de vencimiento ascendente.
3. Toma del primer lote hasta agotarlo o cubrir X.
4. Si no alcanza, continúa con el siguiente lote.

**Flujos alternos:**
- A1: La cantidad requerida se cubre con un solo lote.

**Flujos de excepción:**
- E1: Todos los lotes vigentes son insuficientes → se rechaza la operación.
- E2: Se detecta un lote vencido durante el proceso → se excluye automáticamente y se marca para revisión/merma; puede disparar CU-12.

**Reglas de negocio relacionadas:** FEFO es obligatorio y no configurable; lotes vencidos no son consumibles.

---

## CU-07 — Registrar proveedor y costo de ingreso
**Relacionado:** RF-07
**Actor principal:** Administrador
**Actores secundarios:** Sistema de Inventario

**Precondiciones:** Ninguna para alta de proveedor; para historial de costos, debe existir un ingreso de lote.
**Postcondiciones:** Proveedor y/o costo registrado y consultable.

**Flujo principal:**
1. Administrador registra los datos del proveedor.
2. Al ingresar un lote nuevo, se selecciona el proveedor y se captura el costo de compra.
3. El sistema almacena el costo en el historial vinculado a proveedor-ingrediente-fecha.

**Flujos alternos:**
- A1: Actualización de datos de un proveedor existente.

**Flujos de excepción:**
- E1: Intento de registrar costo sin proveedor asociado → rechazo.

**Reglas de negocio relacionadas:** El historial de costos es de solo agregado (no se editan costos pasados).

---

## CU-08 — Registrar ajuste de inventario por conteo físico
**Relacionado:** RF-08
**Actor principal:** Almacenista
**Actores secundarios:** Sistema de Inventario

**Precondiciones:** El ingrediente existe en el catálogo.
**Postcondiciones:** Stock actualizado; movimiento de ajuste registrado; posible disparo de CU-12 si el ajuste es negativo y afecta recetas.

**Flujo principal:**
1. Almacenista realiza un conteo físico o recibe mercancía.
2. Ingresa la cantidad real observada (o recibida, con datos de lote).
3. El sistema compara con la cantidad registrada y calcula la diferencia.
4. Almacenista confirma el ajuste, indicando motivo si es discrepancia.
5. El sistema actualiza el stock y registra el movimiento como "ajuste manual".

**Flujos alternos:**
- A1: Ingreso de mercancía nueva (alta directa de lote, sin discrepancia previa).

**Flujos de excepción:**
- E1: Ajuste negativo que resultaría en stock por debajo de cero → rechazo, requiere revisión.

**Reglas de negocio relacionadas:** Todo ajuste requiere confirmación humana explícita; no se permite stock negativo.

---

## CU-09 — Consultar inventario desde otro microservicio
**Relacionado:** RF-09
**Actor principal:** Microservicio externo consumidor
**Actores secundarios:** Sistema de Inventario

**Precondiciones:** El microservicio consumidor está autenticado/autorizado.
**Postcondiciones:** Ninguna (solo lectura).

**Flujo principal:**
1. El microservicio externo envía una solicitud autenticada.
2. Inventario valida la autorización.
3. Inventario responde con los datos solicitados (stock, catálogo, estado).

**Flujos de excepción:**
- E1: Solicitud no autenticada/no autorizada → rechazo.
- E2: Intento de operación de escritura → rechazo explícito.

**Reglas de negocio relacionadas:** Ningún consumidor externo puede modificar el stock directamente.

---

## CU-10 — Configurar y monitorear umbrales de stock
**Relacionado:** RF-10
**Actor principal:** Administrador
**Actores secundarios:** Sistema de Inventario (generación automática de alertas)

**Precondiciones:** El ingrediente existe (o se está creando).
**Postcondiciones:** Umbrales definidos; alertas generadas cuando corresponda.

**Flujo principal:**
1. Administrador crea o edita un ingrediente y define umbral mínimo/máximo.
2. El sistema valida que mínimo ≤ máximo.
3. El sistema guarda la configuración.
4. En cada operación que reduzca el stock disponible, el sistema evalúa si cruzó el umbral mínimo.
5. Si se cruza, genera una alerta.

**Flujos de excepción:**
- E1: Mínimo mayor al máximo → rechazo de la configuración.

**Reglas de negocio relacionadas:** Los umbrales aplican sobre el stock disponible, no el físico total.

---

## CU-11 — Registrar receta desde evento de creación de platillo *(nuevo)*
**Relacionado:** RF-11
**Objetivo:** Persistir la receta de un platillo nuevo para que Inventario pueda evaluar disponibilidad de forma autónoma.
**Actor principal:** Microservicio de Órdenes/Cocina (evento `Ordenes.Platillo.Creado`)
**Actores secundarios:** Sistema de Inventario, Administrador (revisión de recetas incompletas)

**Precondiciones:** Idealmente, los ingredientes referenciados ya existen en el catálogo de Inventario.
**Postcondiciones:** Receta almacenada y disponible para CU-01, CU-05 y CU-12.

**Flujo principal:**
1. Órdenes emite `Ordenes.Platillo.Creado` con `platillo_id`, nombre, e ingredientes + cantidades.
2. Inventario recibe el evento y valida que cada ingrediente exista en su catálogo.
3. Inventario registra la receta vinculando `platillo_id` a los ingredientes/SKUs y cantidades.
4. Inventario queda listo para responder consultas de disponibilidad (CU-05) y evaluar reservas (CU-01).

**Flujos alternos:**
- A1: Algunos ingredientes no existen aún en catálogo → se registra receta parcial/incompleta y se alerta al Administrador para completarla o crear los ingredientes faltantes.

**Flujos de excepción:**
- E1: Evento duplicado (mismo `platillo_id`) → idempotencia, no se duplica el registro.

**Reglas de negocio relacionadas:** La receta es la fuente única de verdad para todas las validaciones de disponibilidad; su integridad depende de que los ingredientes referenciados existan en el catálogo.

---

## CU-12 — Notificar indisponibilidad de receta *(nuevo)*
**Relacionado:** RF-12
**Objetivo:** Avisar proactivamente a Órdenes/Cocina cuando un platillo deja de poder prepararse por falta de stock.
**Actor principal:** Sistema de Inventario (proceso interno, disparado por CU-02, CU-06 o CU-08)
**Actores secundarios:** Microservicio de Órdenes/Cocina (receptor del evento)

**Precondiciones:** Existen recetas registradas (CU-11) que usan el ingrediente cuyo stock cambió.
**Postcondiciones:** Evento `Inventario.Receta.NoDisponible` emitido si corresponde; sin efecto si ninguna receta se ve afectada.

**Flujo principal:**
1. Ocurre una operación que reduce el stock disponible de un ingrediente (descuento definitivo, ajuste negativo, o vencimiento de lote).
2. Inventario identifica las recetas registradas que utilizan ese ingrediente.
3. Para cada receta afectada, evalúa si el stock actual sigue siendo suficiente para prepararla (misma lógica que CU-05).
4. Si una receta que antes era "disponible" deja de serlo, Inventario emite `Inventario.Receta.NoDisponible` con `platillo_id` e ingrediente(s) limitante(s).

**Flujos alternos:**
- A1: Ninguna receta registrada usa el ingrediente afectado → no se emite evento.

**Flujos de excepción:**
- E1: Falla al emitir el evento (broker no disponible) → reintento con backoff; debe evitarse la pérdida silenciosa del aviso.

**Reglas de negocio relacionadas:** La evaluación solo se dispara sobre las recetas que usan el ingrediente cuyo stock cambió (no se reevalúan todas las recetas del sistema en cada movimiento); el evento solo se emite en la transición disponible → no disponible, no en cada movimiento de stock.

---

*Cada Caso de Uso se referencia desde la Matriz de Trazabilidad en `1_Requisitos_Inventario.md`. Los Test Cases correspondientes están en `3_Test_Cases_Inventario.md`.*
