---
title: Test Cases — Microservicio de Inventario
sidebar_label: Test cases
sidebar_position: 3
slug: /test-cases
---

# Test Cases — Microservicio de Inventario

Convención de IDs: `TC-[RF]-[secuencial]`. Convención de eventos: `Microservicio.Entidad.Accion`. Este documento complementa a `1_Requisitos_Inventario.md` y `2_Casos_de_Uso_Inventario.md`.

---

## RF-01 / CU-01 — Reserva de inventario al crear una orden

| ID | Nombre | Objetivo | Datos de prueba | Pasos clave | Resultado esperado | Prioridad |
|---|---|---|---|---|---|---|
| TC-01-01 | Reserva exitosa (happy path) | Validar reserva completa | Platillo con receta de 3 ingredientes, todos con stock suficiente | Emitir `Ordenes.Orden.Creada` | `Inventario.Reserva.Confirmada`; stock disponible reducido correctamente por lote FEFO | Alta |
| TC-01-02 | Ingrediente insuficiente | Validar rechazo todo-o-nada | 1 de 3 ingredientes sin stock suficiente | Emitir `Ordenes.Orden.Creada` | `Inventario.Reserva.Rechazada`; ningún ingrediente queda reservado | Alta |
| TC-01-03 | Reserva exacta al límite (edge) | Validar borde de disponibilidad | Cantidad requerida = stock disponible exacto | Emitir `Ordenes.Orden.Creada` | `Inventario.Reserva.Confirmada`; stock disponible queda en 0 | Media |
| TC-01-04 | Concurrencia por el mismo lote | Validar que no haya stock negativo | Dos `Ordenes.Orden.Creada` simultáneas piden el último lote disponible | Emitir ambos eventos en paralelo | Solo una reserva exitosa; la otra se rechaza o reevalúa | Alta |
| TC-01-05 | Evento malformado (negativo) | Validar manejo de error | Evento sin `platillo_id` | Emitir evento inválido | Rechazo controlado, sin crear reserva parcial, log de error | Media |
| TC-01-06 | Platillo sin receta registrada (nuevo) | Validar dependencia de RF-11 | `Ordenes.Orden.Creada` referencia un `platillo_id` que Inventario nunca registró | Emitir evento | Rechazo con error "receta no encontrada" (distinto de stock insuficiente) | Alta |

---

## RF-02 / CU-02 — Descuento definitivo al servir la orden

| ID | Nombre | Objetivo | Datos de prueba | Pasos clave | Resultado esperado | Prioridad |
|---|---|---|---|---|---|---|
| TC-02-01 | Descuento exitoso (happy path) | Validar conversión reserva→descuento | Orden con reserva activa | Emitir `Ordenes.Orden.Servida` | Stock físico descontado; reserva cerrada | Alta |
| TC-02-02 | Devolución posterior a servida | Validar bloqueo de devolución | Orden ya servida | Intentar registrar devolución | Rechazo; se sugiere registrar como merma | Alta |
| TC-02-03 | Evento duplicado (idempotencia) | Validar que no se descuente dos veces | `Ordenes.Orden.Servida` reenviado | Emitir el mismo evento dos veces | Solo un descuento aplicado | Alta |
| TC-02-04 | Orden sin reserva previa (negativo) | Validar manejo de inconsistencia | Evento sin reserva asociada | Emitir evento | No se descuenta; se genera alerta/registro de inconsistencia | Media |
| TC-02-05 | Descuento dispara evaluación de RF-12 (edge) | Validar integración con notificación proactiva | Descuento deja a una receta sin stock suficiente | Emitir `Ordenes.Orden.Servida` | Se dispara evaluación y, si corresponde, se emite `Inventario.Receta.NoDisponible` | Alta |

---

## RF-03 / CU-03 — Liberación de reserva por cancelación

| ID | Nombre | Objetivo | Datos de prueba | Resultado esperado | Prioridad |
|---|---|---|---|---|---|
| TC-03-01 | Cancelación en "Creada" (happy path) | Validar liberación completa | Orden recién creada con reserva, emitir `Ordenes.Orden.Cancelada` | Stock disponible restaurado al 100% | Alta |
| TC-03-02 | Cancelación en "En preparación" | Validar liberación en ese estado | Orden en preparación | Stock disponible restaurado | Alta |
| TC-03-03 | Cancelación tras "Servida" (negativo) | Validar bloqueo | Orden ya servida | Rechazo; se indica registrar merma | Alta |
| TC-03-04 | Cancelación de orden sin reserva (edge) | Validar manejo de inconsistencia | Orden cancelada sin reserva previa | No hay efecto en stock; se registra advertencia | Media |

---

## RF-04 / CU-04 — Registro de merma

| ID | Nombre | Objetivo | Resultado esperado | Prioridad |
|---|---|---|---|---|
| TC-04-01 | Registro de merma (happy path) | Validar creación de registro | Merma registrada con motivo y cantidad; stock disponible sin cambio | Alta |
| TC-04-02 | Merma automática por excepción sin reingreso | Validar automatización | Registro de merma creado sin intervención manual | Media |
| TC-04-03 | Merma sobre orden no servida (negativo) | Validar bloqueo | Rechazo con mensaje indicando usar cancelación | Alta |
| TC-04-04 | Merma con cantidad mayor a la consumida (edge/error) | Validar validación de límites | Rechazo o alerta de inconsistencia | Media |

---

## RF-05 / CU-05 — Validación de disponibilidad de receta (por platillo)

| ID | Nombre | Datos de prueba | Resultado esperado | Prioridad |
|---|---|---|---|---|
| TC-05-01 | Disponibilidad completa (happy path) | `platillo_id` con receta registrada y stock suficiente | Respuesta "disponible: true" | Alta |
| TC-05-02 | Disponibilidad parcial (falta un ingrediente) | Receta con un ingrediente sin stock suficiente | Respuesta indica ingrediente faltante | Alta |
| TC-05-03 | Platillo sin receta registrada (negativo) | `platillo_id` inexistente en Inventario | Error controlado "receta no encontrada" | Alta |
| TC-05-04 | Cantidad solicitada = stock exacto (edge) | Stock disponible igual a lo requerido | Respuesta "disponible: true" | Media |
| TC-05-05 | Timeout del servicio (error) | Simular caída de Inventario | Órdenes recibe error/timeout manejable | Media |

---

## RF-06 / CU-06 — Gestión de lotes FEFO

| ID | Nombre | Resultado esperado | Prioridad |
|---|---|---|---|
| TC-06-01 | FEFO con un solo lote suficiente (happy path) | Se consume ese lote | Alta |
| TC-06-02 | FEFO con múltiples lotes (consumo en cascada) | Se consumen en orden de vencimiento hasta cubrir la cantidad | Alta |
| TC-06-03 | Lote vencido excluido | El lote vencido no se considera disponible | Alta |
| TC-06-04 | Registro de lote nuevo (edge) | Lote creado correctamente y disponible para FEFO | Media |
| TC-06-05 | Cantidad solicitada mayor a la suma de lotes vigentes (error) | Rechazo por stock insuficiente | Media |

---

## RF-07 / CU-07 — Proveedores e historial de costos

| ID | Nombre | Resultado esperado | Prioridad |
|---|---|---|---|
| TC-07-01 | Alta de proveedor (happy path) | Proveedor creado y disponible | Alta |
| TC-07-02 | Registro de costo en ingreso de lote | Costo almacenado en historial | Alta |
| TC-07-03 | Consulta de historial de costos por proveedor | Listado cronológico correcto | Media |
| TC-07-04 | Alta de proveedor con datos incompletos (negativo) | Rechazo por validación | Media |
| TC-07-05 | Costo negativo o cero (edge/error) | Rechazo por validación de negocio | Media |

---

## RF-08 / CU-08 — Ajuste manual por conteo físico

| ID | Nombre | Resultado esperado | Prioridad |
|---|---|---|---|
| TC-08-01 | Ingreso de mercancía nueva (happy path) | Lote creado, stock incrementado | Alta |
| TC-08-02 | Ajuste positivo por conteo | Stock corregido al alza, motivo registrado | Media |
| TC-08-03 | Ajuste negativo por conteo (merma no detectada antes) | Stock corregido a la baja, motivo registrado | Alta |
| TC-08-04 | Ajuste que provocaría stock negativo (negativo/error) | Rechazo, solicitud de revisión | Alta |
| TC-08-05 | Ajuste negativo dispara evaluación de RF-12 (edge) | Se evalúa si alguna receta afectada deja de ser preparable | Alta |

---

## RF-09 / CU-09 — Consulta de inventario por otros microservicios

| ID | Nombre | Resultado esperado | Prioridad |
|---|---|---|---|
| TC-09-01 | Consulta autorizada (happy path) | Datos de stock retornados correctamente | Alta |
| TC-09-02 | Consulta no autorizada (negativo) | Rechazo 403 | Alta |
| TC-09-03 | Intento de escritura vía API de consulta (error) | Rechazo, método no permitido | Media |
| TC-09-04 | Consulta de ingrediente inexistente (edge) | Respuesta controlada "no encontrado" | Media |

---

## RF-10 / CU-10 — Umbrales mínimo/máximo

| ID | Nombre | Resultado esperado | Prioridad |
|---|---|---|---|
| TC-10-01 | Configuración válida de umbrales (happy path) | Umbrales guardados correctamente | Alta |
| TC-10-02 | Edición de umbrales existentes | Nuevos valores aplicados | Media |
| TC-10-03 | Umbral mínimo mayor al máximo (negativo) | Rechazo de configuración | Alta |
| TC-10-04 | Cruce de umbral mínimo tras un descuento (edge) | Alerta generada automáticamente | Alta |
| TC-10-05 | Umbrales en cero o negativos (error) | Rechazo por validación | Media |

---

## RF-11 / CU-11 — Registro de receta al crear un platillo *(nuevo)*

| ID | Nombre | Objetivo | Datos de prueba | Pasos clave | Resultado esperado | Prioridad |
|---|---|---|---|---|---|---|
| TC-11-01 | Registro exitoso de receta (happy path) | Validar persistencia de receta | Evento con 4 ingredientes, todos existentes en catálogo | Emitir `Ordenes.Platillo.Creado` | Receta almacenada correctamente, vinculada a `platillo_id` | Alta |
| TC-11-02 | Ingrediente no encontrado en catálogo | Validar manejo de referencia inválida | Evento con 1 ingrediente inexistente en Inventario | Emitir `Ordenes.Platillo.Creado` | Receta registrada como incompleta; alerta generada para revisión | Alta |
| TC-11-03 | Evento duplicado (idempotencia) | Validar que no se duplique la receta | Mismo `platillo_id` enviado dos veces | Emitir el evento dos veces | Solo un registro de receta persiste | Alta |
| TC-11-04 | Receta con lista vacía de ingredientes (negativo/error) | Validar validación de datos | Evento sin ingredientes | Emitir evento inválido | Rechazo controlado, log de error | Media |

---

## RF-12 / CU-12 — Notificación proactiva de indisponibilidad de receta *(nuevo)*

| ID | Nombre | Objetivo | Datos de prueba | Pasos clave | Resultado esperado | Prioridad |
|---|---|---|---|---|---|---|
| TC-12-01 | Receta deja de estar disponible tras descuento (happy path) | Validar detección y emisión de evento | Receta al límite; se descuenta el último ingrediente crítico | Emitir `Ordenes.Orden.Servida` que consume el ingrediente | Se emite `Inventario.Receta.NoDisponible` con el platillo e ingrediente limitante | Alta |
| TC-12-02 | Ingrediente afectado no está en ninguna receta (edge) | Validar que no se genere ruido innecesario | Movimiento de stock sobre un ingrediente sin recetas asociadas | Ejecutar descuento/ajuste | No se emite ningún evento | Media |
| TC-12-03 | Múltiples recetas afectadas por el mismo ingrediente | Validar evaluación completa | Ingrediente usado en 3 recetas, stock cae por debajo del umbral necesario para 2 de ellas | Ejecutar movimiento que reduce el stock | Se emiten 2 eventos `Inventario.Receta.NoDisponible`, uno por cada platillo afectado | Alta |
| TC-12-04 | Falla al emitir el evento (error) | Validar reintento | Broker de eventos no disponible al momento de emitir | Forzar caída del broker | Reintento con backoff; el aviso no se pierde silenciosamente | Media |
| TC-12-05 | Ingrediente reducido pero aún suficiente (negativo) | Validar que no se marque falsamente como no disponible | Stock reducido pero aún por encima de lo requerido por la receta | Ejecutar movimiento de stock | No se emite evento; la receta sigue "disponible" | Alta |

---

*Cada Test Case valida los Criterios de Aceptación definidos en `1_Requisitos_Inventario.md` para su requisito correspondiente, y ejercita el flujo descrito en `2_Casos_de_Uso_Inventario.md`.*
