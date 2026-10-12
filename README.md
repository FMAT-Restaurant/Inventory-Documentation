# Documentación del microservicio de Inventario

Sitio de documentación del microservicio de **Inventario** (sistema de restaurante/cocina):
requisitos, casos de uso, test cases y referencia del contrato de API.

- [Sitio publicado](https://fmat-restaurant.github.io/Inventory-Documentation/)

## Contenido

| Documento | Descripción |
| :--- | :--- |
| [`docs/1_Requisitos_Inventario.md`](docs/1_Requisitos_Inventario.md) | Requisitos (RF-01…RF-12, RNF), criterios de aceptación, impacto, trazabilidad. |
| [`docs/2_Casos_de_Uso_Inventario.md`](docs/2_Casos_de_Uso_Inventario.md) | Casos de uso CU-01…CU-12. |
| [`docs/3_Test_Cases_Inventario.md`](docs/3_Test_Cases_Inventario.md) | Casos de prueba TC-* trazados a requisitos y casos de uso. |
| [`docs/mockups.md`](docs/mockups.md) | Mockups de interfaz. |
| [`apis/inventory/openapi.yaml`](apis/inventory/openapi.yaml) | Contrato OpenAPI del Inventory Backend (referencia Scalar). |

## Desarrollo local

Requiere Node.js `>=22.12.0` y pnpm.

```bash
pnpm install
pnpm docs:dev      # servidor de desarrollo
pnpm docs:build    # build de producción (incluye bundle OpenAPI)
```

## Despliegue

El workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) compila el
sitio Docusaurus y lo publica en GitHub Pages ante cada push a `main`. La fuente de Pages debe estar
configurada como **GitHub Actions** en la configuración del repositorio.
